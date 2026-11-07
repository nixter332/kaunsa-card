/**
 * Offers agent: reads a bank-offer or card-benefit page and proposes entries for data/offers.json.
 * Same idea as the rules agent: Claude reads, a person reviews, nothing goes live without --apply.
 *
 *   npm run offers -- --source <url|file.pdf|file.txt> [--source ...] [--name <slug>]
 *   npm run offers -- --apply <slug>        add the reviewed proposal to data/offers.json
 *   npm run offers -- --status              list offers: live, upcoming, expired
 *   npm run offers -- --prune               remove expired offers
 *
 * If a page loads with JavaScript and comes back empty, save it as PDF (or copy the offer text
 * into a .txt file) and pass that file instead.
 */
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { MERCHANTS } from "../lib/localParse";
import { dayList, istDate, istWeekday, offerCovers, validateOffer } from "../lib/offers";
import { callTool } from "../lib/toolCall";
import { CATEGORIES, WEEKDAYS, type Card, type Offer } from "../lib/types";

const ROOT = path.resolve(__dirname, "..");
const OFFERS_PATH = path.join(ROOT, "data/offers.json");
const PROPOSED_DIR = path.join(ROOT, "data/proposed");
const MODEL = process.env.ANTHROPIC_EXTRACT_MODEL ?? "claude-sonnet-5-5";

const sources: string[] = [];
const args: Record<string, string> = {};
process.argv.slice(2).forEach((a, i, all) => {
  if (!a.startsWith("--")) return;
  const value = all[i + 1] === undefined || all[i + 1].startsWith("--") ? "true" : all[i + 1];
  if (a === "--source") sources.push(value);
  else args[a.slice(2)] = value;
});

type CatalogEntry = { id: string; name: string; issuer: string; network: Card["network"] };
const readJson = <T,>(p: string, fallback: T): T => (fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as T) : fallback);
const cards = readJson<Card[]>(path.join(ROOT, "data/cards.json"), []);
const catalog = readJson<CatalogEntry[]>(path.join(ROOT, "data/catalog.json"), []);
const known: CatalogEntry[] = [...cards, ...catalog.filter((c) => !cards.some((k) => k.id === c.id))];
const issuers = [...new Set(known.map((c) => c.issuer))];
const loadOffers = (): Offer[] => readJson<Offer[]>(OFFERS_PATH, []);
const now = new Date();
const today = istDate(now);
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

async function loadSource(src: string): Promise<{ kind: "pdf"; base64: string } | { kind: "text"; text: string }> {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { headers: { "User-Agent": "Mozilla/5.0 (Kaunsa Card offers reader)" } });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    if ((res.headers.get("content-type") ?? "").includes("pdf") || src.toLowerCase().endsWith(".pdf")) {
      return { kind: "pdf", base64: Buffer.from(await res.arrayBuffer()).toString("base64") };
    }
    return { kind: "text", text: htmlToText(await res.text()) };
  }
  if (src.toLowerCase().endsWith(".pdf")) return { kind: "pdf", base64: fs.readFileSync(src).toString("base64") };
  const raw = fs.readFileSync(src, "utf8");
  return { kind: "text", text: /\.html?$/i.test(src) ? htmlToText(raw) : raw };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/(tr|p|li|h\d|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8377;|&#x20b9;/gi, "₹")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .slice(0, 150_000);
}

const offerSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "kebab-case, e.g. 'indusind-goibibo-flights-2026-11'" },
    title: { type: "string", description: "Short, shown to users, e.g. 'IndusInd × Goibibo flights' or 'BookMyShow buy 1 get 1'" },
    kind: { type: "string", enum: ["bank_offer", "card_perk"], description: "bank_offer = time-limited merchant offer; card_perk = lasting benefit of a specific card" },
    issuer: { type: "string", enum: issuers, description: "Set when the offer covers ALL credit cards of a bank. Leave out when only specific cards qualify." },
    cardIds: { type: "array", items: { type: "string", enum: known.map((c) => c.id) }, description: "Set when only specific cards qualify." },
    networks: { type: "array", items: { type: "string", enum: ["Visa", "Mastercard", "RuPay"] }, description: "Only if the offer is limited to a card network." },
    excludeCardIds: { type: "array", items: { type: "string", enum: known.map((c) => c.id) }, description: "Cards of that bank the document says are NOT eligible." },
    merchants: { type: "array", items: { type: "string", enum: MERCHANTS.map((m) => m.id) } },
    categories: { type: "array", items: { type: "string", enum: [...CATEGORIES] }, description: "Usually leave out. Only to narrow a merchant that sells several kinds of things." },
    discount_type: { type: "string", enum: ["percent", "flat"] },
    discount_value: { type: "number", description: "percent as a fraction (10% = 0.1); flat in rupees" },
    max_discount: { type: "number", description: "Rupee cap on a percent discount ('up to ₹1,500')" },
    min_txn: { type: "number", description: "Minimum booking/transaction value in rupees" },
    valid_from: { type: "string", description: "YYYY-MM-DD" },
    valid_to: { type: "string", description: "YYYY-MM-DD, inclusive. Required for bank_offer." },
    days: { type: "array", items: { type: "string", enum: [...WEEKDAYS] }, description: "Only if the offer runs on certain weekdays" },
    uses_per_month: { type: "number", description: "Per card, e.g. '1 booking per card per month' = 1" },
    payment: { type: "string", enum: ["full", "emi", "any"], description: "emi = only on (no-cost) EMI transactions" },
    code: { type: "string", description: "Coupon code to enter, if any" },
    conditions: { type: "string", description: "ONE short line for users, e.g. 'Domestic flights only; hotels have a different offer'" },
    evidence: { type: "string", description: "Short verbatim quote from the document that states the discount, cap and minimum" },
  },
  required: ["id", "title", "kind", "merchants", "discount_type", "discount_value", "evidence"],
};

const submitTool: Anthropic.Tool = {
  name: "submit_offers",
  description: "Submit the credit-card offers found in the documents.",
  input_schema: {
    type: "object",
    properties: {
      offers: { type: "array", items: offerSchema },
      skipped: { type: "array", items: { type: "string" }, description: "Offers seen but not submitted, each with the reason (debit cards only, expired, a second row for the same merchant, card not in our list…)" },
      notes: { type: "array", items: { type: "string" } },
    },
    required: ["offers"],
  },
};

type RawOffer = {
  id: string;
  title: string;
  kind: Offer["kind"];
  issuer?: string;
  cardIds?: string[];
  networks?: Offer["networks"];
  excludeCardIds?: string[];
  merchants: string[];
  categories?: Offer["categories"];
  discount_type: "percent" | "flat";
  discount_value: number;
  max_discount?: number;
  min_txn?: number;
  valid_from?: string;
  valid_to?: string;
  days?: Offer["days"];
  uses_per_month?: number;
  payment?: "full" | "emi" | "any";
  code?: string;
  conditions?: string;
  evidence: string;
};

function toOffer(r: RawOffer, source: string): Offer {
  const o: Offer = {
    id: r.id,
    title: r.title,
    kind: r.kind,
    ...(r.cardIds?.length ? { cardIds: r.cardIds } : r.issuer ? { issuer: r.issuer } : {}),
    ...(r.networks?.length && { networks: r.networks }),
    ...(r.excludeCardIds?.length && { excludeCardIds: r.excludeCardIds }),
    merchants: r.merchants,
    ...(r.categories?.length && { categories: r.categories }),
    discount: r.discount_type === "flat" ? { type: "flat", value: r.discount_value } : { type: "percent", value: r.discount_value, ...(r.max_discount && { max: r.max_discount }) },
    ...(r.min_txn && { minTxn: r.min_txn }),
    ...(r.valid_from && { validFrom: r.valid_from }),
    ...(r.valid_to && { validTo: r.valid_to }),
    ...(r.days?.length && r.days.length < 7 && { days: r.days }),
    ...(r.uses_per_month && { usesPerMonth: r.uses_per_month }),
    ...(r.payment === "emi" && { payment: "emi" as const }),
    ...(r.code && { code: r.code }),
    ...(r.conditions && { conditions: r.conditions }),
    source,
    lastVerified: today,
  };
  return o;
}

function describe(o: Offer): string[] {
  const d = o.discount;
  const deal = d.type === "flat" ? `${rupees(d.value)} off` : `${Math.round(d.value * 1000) / 10}% off${d.max ? ` up to ${rupees(d.max)}` : ""}`;
  const covered = known.filter((c) => offerCovers(o, c as Card));
  const yours = cards.filter((c) => offerCovers(o, c));
  return [
    `  ${o.title}  [${o.id}]`,
    `    Deal: ${deal}${o.minTxn ? ` on ${rupees(o.minTxn)}+` : ""}${o.payment === "emi" ? ", no-cost EMI only" : ""}${o.code ? `, code ${o.code}` : ""}`,
    `    Where: ${o.merchants.map((m) => MERCHANTS.find((x) => x.id === m)?.name ?? m).join(", ")}${o.categories ? ` (${o.categories.join(", ")})` : ""}`,
    `    Cards: ${o.cardIds ? o.cardIds.join(", ") : `all ${o.issuer} credit cards`}${o.networks ? ` (${o.networks.join("/")} only)` : ""}${o.excludeCardIds ? `, except ${o.excludeCardIds.join(", ")}` : ""}` +
      ` → covers ${covered.length} card(s) we know${yours.length ? `, ${yours.length} with rules in the app` : ""}`,
    `    When: ${o.kind === "card_perk" ? "lasting card perk" : `${o.validFrom ?? "now"} to ${o.validTo}`}${o.days ? `, ${dayList(o.days)} only` : ""}${o.usesPerMonth ? `, ${o.usesPerMonth}× per card per month` : ""}`,
    ...(o.conditions ? [`    Note for users: ${o.conditions}`] : []),
  ];
}

async function extract() {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const [i, src] of sources.entries()) {
    console.log(`Reading source ${i + 1}/${sources.length}: ${src}`);
    try {
      const s = await loadSource(src);
      if (s.kind === "text" && s.text.length < 400) {
        console.log(`⚠ ${src} came back almost empty (it probably loads with JavaScript). Save it as PDF, or copy the offer text into a .txt file, and pass that.`);
        continue;
      }
      blocks.push(
        s.kind === "pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: s.base64 }, title: `Source ${i + 1}` }
          : { type: "text", text: `<document index="${i + 1}" source="${src}">\n${s.text}\n</document>` },
      );
    } catch (e) {
      console.log(`⚠ Couldn't read ${src}: ${(e as Error).message}. Save it as PDF (or copy the text into a .txt file) and pass the file.`);
    }
  }
  if (!blocks.length) throw new Error("No readable source, so nothing was extracted.");

  console.log(`Extracting offers with ${MODEL}…`);
  const out = await callTool<{ offers?: RawOffer[]; skipped?: string[]; notes?: string[] }>(
    new Anthropic(),
    {
      model: MODEL,
      max_tokens: 12000,
      tools: [submitTool],
      system:
        "You turn Indian credit-card offer pages and card-benefit documents into structured offers. Extract ONLY what the documents state; never guess a number or date. " +
        "Always respond by calling the submit_offers tool exactly once; never reply in plain text. " +
        `Today is ${today} (${istWeekday(now)}) in India. ` +
        "Rules: " +
        "Only CREDIT card offers. Skip debit-card, net-banking, wallet and EMI-card-only offers (list them in skipped). " +
        "Use issuer when all credit cards of a bank qualify; use cardIds when only named cards qualify; if none of the named cards are in the enum, skip it. Put cards the document excludes in excludeCardIds. " +
        "The app can't tell flights from hotels or domestic from international on the same site. When a page has several rows for the same merchant, submit ONE offer for the row most people use (usually domestic flights, full payment), " +
        "say so in conditions (e.g. 'Domestic flights; hotels and international differ'), and list the other rows in skipped. " +
        "If the only version is on (no-cost) EMI, set payment 'emi'. If both full-payment and EMI rows exist, submit the full-payment one. " +
        "Buy-one-get-one perks: discount_type percent, discount_value 0.5, max_discount = the cap on the free ticket, conditions like 'Buy 1 get 1; book 2+ tickets'. " +
        "Bank offers need valid_to; skip offers with no end date or that already ended, and say so in skipped. Card perks (lasting card benefits) have no valid_to. " +
        "Write dates as YYYY-MM-DD ('30th Nov'26' = 2026-11-30). Ids are kebab-case and include the month for bank offers.",
      messages: [
        {
          role: "user",
          content: [
            ...blocks,
            {
              type: "text",
              text:
                "Submit the credit-card offers in these documents.\n\nCards the app knows (id: name, issuer, network):\n" +
                known.map((c) => `${c.id}: ${c.name}, ${c.issuer}, ${c.network}`).join("\n"),
            },
          ],
        },
      ],
    },
    "submit_offers",
  );

  const source = sources.join(" + ");
  const knownIds = known.map((c) => c.id);
  const merchantIds = MERCHANTS.map((m) => m.id);
  const accepted: Offer[] = [];
  const evidence: Record<string, string> = {};
  for (const raw of out.offers ?? []) {
    const offer = toOffer(raw, source);
    const errors = validateOffer(offer, knownIds, merchantIds, issuers);
    if (offer.validTo && offer.validTo < today) errors.push(`already ended on ${offer.validTo}`);
    if (errors.length) {
      console.log(`✗ Dropped "${raw.title}": ${errors.join("; ")}`);
      continue;
    }
    accepted.push(offer);
    evidence[offer.id] = raw.evidence;
  }

  console.log(accepted.length ? "\nProposed offers:" : "\nNo usable offers found.");
  const existing = loadOffers();
  for (const o of accepted) {
    console.log(describe(o).join("\n"));
    console.log(`    Evidence: "${evidence[o.id]}"`);
    if (existing.some((e) => e.id === o.id)) console.log("    (replaces the offer with the same id)");
    console.log("");
  }
  if (out.skipped?.length) console.log("Skipped:\n" + out.skipped.map((s) => `  - ${s}`).join("\n"));
  if (out.notes?.length) console.log("Notes from the model:\n" + out.notes.map((s) => `  - ${s}`).join("\n"));
  if (!accepted.length) return;

  const slug =
    args.name && args.name !== "true"
      ? args.name
      : `offers-${accepted[0].id}`.replace(/[^a-z0-9-]/g, "-").slice(0, 60);
  fs.mkdirSync(PROPOSED_DIR, { recursive: true });
  const file = path.join(PROPOSED_DIR, `${slug}.json`);
  fs.writeFileSync(file, JSON.stringify({ offers: accepted, evidence, skipped: out.skipped ?? [], notes: out.notes ?? [] }, null, 2) + "\n");
  console.log(`\nProposal saved to ${path.relative(ROOT, file)}. Check the numbers against the page (edit the file if needed), then:\n  npm run offers -- --apply ${slug}`);
}

function apply(slug: string) {
  const file = path.join(PROPOSED_DIR, slug.endsWith(".json") ? slug : `${slug}.json`);
  if (!fs.existsSync(file)) throw new Error(`No proposal at ${path.relative(ROOT, file)}`);
  const { offers } = JSON.parse(fs.readFileSync(file, "utf8")) as { offers: Offer[] };
  const all = loadOffers();
  const merchantIds = MERCHANTS.map((m) => m.id);
  for (const o of offers) {
    const errors = validateOffer(o, known.map((c) => c.id), merchantIds, issuers);
    if (errors.length) throw new Error(`${o.id}: ${errors.join("; ")} (fix the proposal file and try again)`);
    const i = all.findIndex((x) => x.id === o.id);
    if (i >= 0) all[i] = o;
    else all.push(o);
    console.log(`✓ ${i >= 0 ? "Updated" : "Added"} ${o.id}`);
  }
  fs.writeFileSync(OFFERS_PATH, JSON.stringify(all, null, 2) + "\n");
  console.log(`data/offers.json now has ${all.length} offer(s). Run npm test, then commit and push.`);
}

function status() {
  const all = loadOffers();
  if (!all.length) return console.log("No offers yet. Add one with: npm run offers -- --source <offer page url>");
  for (const o of [...all].sort((a, b) => (a.validTo ?? "9999").localeCompare(b.validTo ?? "9999"))) {
    const state =
      o.validTo && o.validTo < today ? "EXPIRED " : o.validFrom && o.validFrom > today ? "UPCOMING" : "LIVE    ";
    console.log(`${state} ${o.id}  ${o.kind === "card_perk" ? "(card perk)" : `ends ${o.validTo}`}  checked ${o.lastVerified}`);
  }
  const expired = all.filter((o) => o.validTo && o.validTo < today).length;
  if (expired) console.log(`\n${expired} expired. Remove them with: npm run offers -- --prune`);
}

function prune() {
  const all = loadOffers();
  const keep = all.filter((o) => !o.validTo || o.validTo >= today);
  fs.writeFileSync(OFFERS_PATH, JSON.stringify(keep, null, 2) + "\n");
  console.log(`Removed ${all.length - keep.length} expired offer(s); ${keep.length} left.`);
}

(async () => {
  if (args.status) return status();
  if (args.prune) return prune();
  if (args.apply && args.apply !== "true") return apply(args.apply);
  if (!sources.length) throw new Error("Usage: --source <url|file> [--source ...] [--name slug] | --apply <slug> | --status | --prune");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY in .env.local or your shell");
  if (!issuers.length) throw new Error("No cards found in data/cards.json");
  await extract();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
