/**
 * Offers agent: reads bank-offer pages and card pages, and proposes entries for data/offers.json.
 * Same idea as the rules agent: Claude reads, a person reviews, nothing goes live without --apply.
 *
 *   npm run offers -- --batch                    read every page in data/offer-sources.json
 *   npm run offers -- --perks                    read every card's own pages for lasting perks (movie BOGO etc.)
 *   npm run offers -- --source <url|file> [--source …] [--name <slug>]   one page (or a saved PDF / .txt)
 *   npm run offers -- --apply-ready              apply everything the last batch marked ready
 *   npm run offers -- --apply <slug>[,<slug>…]   apply whole proposal files
 *   npm run offers -- --apply-ids <id>[,<id>…]   apply single offers by id, from any proposal file
 *   npm run offers -- --status                   list offers: live, upcoming, expired
 *   npm run offers -- --prune                    remove expired offers
 *
 * Batch runs write data/proposed/REVIEW-offers.md, sorted into: ready, needs a manual look, nothing found.
 * Pages that load with JavaScript come back empty: save them as PDF (Ctrl+P) and run that one with --source.
 */
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { MERCHANTS } from "../lib/localParse";
import {
  dayList,
  findDuplicate,
  istDate,
  istWeekday,
  offerCovers,
  validateOffer,
} from "../lib/offers";
import { callTool } from "../lib/toolCall";
import { CATEGORIES, WEEKDAYS, type Card, type Offer } from "../lib/types";

const ROOT = path.resolve(__dirname, "..");
const OFFERS_PATH = path.join(ROOT, "data/offers.json");
const SOURCES_PATH = path.join(ROOT, "data/offer-sources.json");
const PROPOSED_DIR = path.join(ROOT, "data/proposed");
const READY_PATH = path.join(PROPOSED_DIR, "offers-ready.json");
const MODEL = process.env.ANTHROPIC_EXTRACT_MODEL ?? "claude-sonnet-5-5";

const sources: string[] = [];
const args: Record<string, string> = {};
process.argv.slice(2).forEach((a, i, all) => {
  if (!a.startsWith("--")) return;
  const value =
    all[i + 1] === undefined || all[i + 1].startsWith("--")
      ? "true"
      : all[i + 1];
  if (a === "--source") sources.push(value);
  else args[a.slice(2)] = value;
});

type CatalogEntry = {
  id: string;
  name: string;
  issuer: string;
  network: Card["network"];
  sources?: string[];
};
type KnownCard = Pick<Card, "id" | "name" | "issuer" | "network">;
type SourceEntry = { id: string; label: string; url: string };
const readJson = <T>(p: string, fallback: T): T =>
  fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as T) : fallback;
const cards = readJson<Card[]>(path.join(ROOT, "data/cards.json"), []);
const catalog = readJson<CatalogEntry[]>(
  path.join(ROOT, "data/catalog.json"),
  [],
);
const known: KnownCard[] = [
  ...cards,
  ...catalog.filter((c) => !cards.some((k) => k.id === c.id)),
];
const issuers = [...new Set(known.map((c) => c.issuer))];
const loadOffers = (): Offer[] => readJson<Offer[]>(OFFERS_PATH, []);
const now = new Date();
const today = istDate(now);
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

async function loadSource(
  src: string,
): Promise<{ kind: "pdf"; base64: string } | { kind: "text"; text: string }> {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, {
      headers: { "User-Agent": "Mozilla/5.0 (Kaunsa Card offers reader)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok)
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    if (
      (res.headers.get("content-type") ?? "").includes("pdf") ||
      src.toLowerCase().endsWith(".pdf")
    ) {
      return {
        kind: "pdf",
        base64: Buffer.from(await res.arrayBuffer()).toString("base64"),
      };
    }
    return { kind: "text", text: htmlToText(await res.text()) };
  }
  if (src.toLowerCase().endsWith(".pdf"))
    return { kind: "pdf", base64: fs.readFileSync(src).toString("base64") };
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
    id: {
      type: "string",
      description:
        "kebab-case, e.g. 'indusind-goibibo-flights-2026-11' or 'tiger-bookmyshow-free-ticket'",
    },
    title: {
      type: "string",
      description:
        "Short, shown to users, e.g. 'IndusInd × Goibibo flights' or 'BookMyShow buy 1 get 1'",
    },
    kind: {
      type: "string",
      enum: ["bank_offer", "card_perk"],
      description:
        "bank_offer = time-limited merchant offer; card_perk = lasting benefit of a specific card",
    },
    issuer: {
      type: "string",
      enum: issuers,
      description:
        "Set when the offer covers ALL credit cards of a bank. Leave out when only specific cards qualify.",
    },
    cardIds: {
      type: "array",
      items: { type: "string", enum: known.map((c) => c.id) },
      description: "Set when only specific cards qualify.",
    },
    networks: {
      type: "array",
      items: { type: "string", enum: ["Visa", "Mastercard", "RuPay"] },
      description: "Only if the offer is limited to a card network.",
    },
    excludeCardIds: {
      type: "array",
      items: { type: "string", enum: known.map((c) => c.id) },
      description: "Cards of that bank the document says are NOT eligible.",
    },
    merchants: {
      type: "array",
      items: { type: "string", enum: MERCHANTS.map((m) => m.id) },
    },
    categories: {
      type: "array",
      items: { type: "string", enum: [...CATEGORIES] },
      description:
        "Usually leave out. Only to narrow a merchant that sells several kinds of things.",
    },
    discount_type: { type: "string", enum: ["percent", "flat"] },
    discount_value: {
      type: "number",
      description: "percent as a fraction (10% = 0.1); flat in rupees",
    },
    max_discount: {
      type: "number",
      description: "Rupee cap on a percent discount ('up to ₹1,500')",
    },
    min_txn: {
      type: "number",
      description: "Minimum booking/transaction value in rupees",
    },
    valid_from: { type: "string", description: "YYYY-MM-DD" },
    valid_to: {
      type: "string",
      description: "YYYY-MM-DD, inclusive. Required for bank_offer.",
    },
    days: {
      type: "array",
      items: { type: "string", enum: [...WEEKDAYS] },
      description: "Only if the offer runs on certain weekdays",
    },
    uses_per_month: {
      type: "number",
      description: "Per card, e.g. '1 booking per card per month' = 1",
    },
    uses_per_year: {
      type: "number",
      description:
        "Per card per calendar year, e.g. 'once every 6 months' = 2, 'once a quarter' = 4",
    },
    payment: {
      type: "string",
      enum: ["full", "emi", "any"],
      description: "emi = only on (no-cost) EMI transactions",
    },
    code: { type: "string", description: "Coupon code to enter, if any" },
    conditions: {
      type: "string",
      description:
        "ONE short line for users, e.g. 'Domestic flights only; hotels have a different offer'",
    },
    evidence: {
      type: "string",
      description:
        "Short verbatim quote from the document that states the discount, cap and minimum",
    },
  },
  required: [
    "id",
    "title",
    "kind",
    "merchants",
    "discount_type",
    "discount_value",
    "evidence",
  ],
};

const submitTool: Anthropic.Tool = {
  name: "submit_offers",
  description: "Submit the credit-card offers found in the documents.",
  input_schema: {
    type: "object",
    properties: {
      offers: { type: "array", items: offerSchema },
      skipped: {
        type: "array",
        items: { type: "string" },
        description:
          "Offers seen but not submitted, each with the reason (debit cards only, expired, shop not in the list, card not in our list…)",
      },
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
  uses_per_year?: number;
  payment?: "full" | "emi" | "any";
  code?: string;
  conditions?: string;
  evidence: string;
};

function toOffer(r: RawOffer, source: string): Offer {
  return {
    id: slugify(r.id),
    title: r.title,
    kind: r.kind,
    ...(r.cardIds?.length
      ? { cardIds: r.cardIds }
      : r.issuer
        ? { issuer: r.issuer }
        : {}),
    ...(r.networks?.length && { networks: r.networks }),
    ...(r.excludeCardIds?.length && { excludeCardIds: r.excludeCardIds }),
    merchants: r.merchants,
    ...(r.categories?.length && { categories: r.categories }),
    discount:
      r.discount_type === "flat"
        ? { type: "flat", value: r.discount_value }
        : {
            type: "percent",
            value: r.discount_value,
            ...(r.max_discount && { max: r.max_discount }),
          },
    ...(r.min_txn && { minTxn: r.min_txn }),
    ...(r.valid_from && { validFrom: r.valid_from }),
    ...(r.valid_to && { validTo: r.valid_to }),
    ...(r.days?.length && r.days.length < 7 && { days: r.days }),
    ...(r.uses_per_month && { usesPerMonth: Math.round(r.uses_per_month) }),
    ...(r.uses_per_year && { usesPerYear: Math.round(r.uses_per_year) }),
    ...(r.payment === "emi" && { payment: "emi" as const }),
    ...(r.code && { code: r.code }),
    ...(r.conditions && { conditions: r.conditions }),
    source,
    lastVerified: today,
  };
}

function describe(o: Offer): string[] {
  const d = o.discount;
  const deal =
    d.type === "flat"
      ? `${rupees(d.value)} off`
      : `${Math.round(d.value * 1000) / 10}% off${d.max ? ` up to ${rupees(d.max)}` : ""}`;
  const covered = known.filter((c) => offerCovers(o, c as Card));
  const yours = cards.filter((c) => offerCovers(o, c));
  const limits = [
    o.usesPerMonth && `${o.usesPerMonth}× per card per month`,
    o.usesPerYear && `${o.usesPerYear}× per card per year`,
  ]
    .filter(Boolean)
    .join(", ");
  return [
    `  ${o.title}  [${o.id}]`,
    `    Deal: ${deal}${o.minTxn ? ` on ${rupees(o.minTxn)}+` : ""}${o.payment === "emi" ? ", no-cost EMI only" : ""}${o.code ? `, code ${o.code}` : ""}`,
    `    Where: ${o.merchants.map((m) => MERCHANTS.find((x) => x.id === m)?.name ?? m).join(", ")}${o.categories ? ` (${o.categories.join(", ")})` : ""}`,
    `    Cards: ${o.cardIds ? o.cardIds.join(", ") : `all ${o.issuer} credit cards`}${o.networks ? ` (${o.networks.join("/")} only)` : ""}${o.excludeCardIds ? `, except ${o.excludeCardIds.join(", ")}` : ""}` +
      ` → covers ${covered.length} card(s) we know${yours.length ? `, ${yours.length} with rules in the app` : ""}`,
    `    When: ${o.kind === "card_perk" ? "lasting card perk" : `${o.validFrom ?? "now"} to ${o.validTo}`}${o.days ? `, ${dayList(o.days)} only` : ""}${limits ? `, ${limits}` : ""}`,
    ...(o.conditions ? [`    Note for users: ${o.conditions}`] : []),
  ];
}

/** Things a person should look at before an offer goes live. Any warning keeps a page out of "ready". */
function warnings(o: Offer, evidence: string): string[] {
  const w: string[] = [];
  if (o.discount.type === "percent" && !o.discount.max)
    w.push("percent discount with no cap: check the page for a maximum");
  if (/up\s*to\s*\d+(\.\d+)?\s*%/i.test(evidence))
    w.push(
      "headline 'up to N%' rate: the real rate for a normal booking may be lower",
    );
  if (
    o.kind === "card_perk" &&
    o.discount.type === "percent" &&
    o.discount.value >= 0.5 &&
    !o.discount.max
  )
    w.push("buy-1-get-1 with no cap on the free ticket");
  return w;
}

type Result = {
  status: "ready" | "manual" | "none";
  why?: string; // for manual / none
  offers: Offer[];
  evidence: Record<string, string>;
  duplicates: Record<string, string>; // new id → existing id
  flagged: Record<string, string[]>; // id → warnings
  lines: string[];
  skipped: string[];
  notes: string[];
};

const BASE_RULES =
  "You turn Indian credit-card offer pages and card-benefit documents into structured offers. Extract ONLY what the documents state; never guess a number or date. " +
  "Always respond by calling the submit_offers tool exactly once (with an empty list if there is nothing); never reply in plain text. " +
  `Today is ${today} (${istWeekday(now)}) in India. ` +
  "Rules: " +
  "Only CREDIT card offers at shops in the merchants enum. Skip debit-card, net-banking, wallet-only and EMI-card-only offers, and shops not in the enum (list them in skipped). " +
  "Do NOT submit a card's normal reward rates (e.g. '5% cashback on Swiggy', '10X points'); those are handled elsewhere. Only instant discounts, coupon deals and perks like free or buy-1-get-1 tickets. " +
  "Use issuer when all credit cards of a bank qualify; use cardIds when only named cards qualify; if none of the named cards are in the enum, skip it. Put cards the document excludes in excludeCardIds. " +
  "The app can't tell flights from hotels or domestic from international on the same site. When a page has several rows for the same merchant, submit ONE offer for the row most people use (usually domestic flights, full payment), " +
  "say so in conditions (e.g. 'Domestic flights; hotels and international differ'), and list the other rows in skipped. " +
  "If the only version is on (no-cost) EMI, set payment 'emi'. If both full-payment and EMI rows exist, submit the full-payment one. " +
  "Buy-one-get-one: discount_type percent, discount_value 0.5, max_discount = the cap on the free ticket, conditions like 'Buy 1 get 1; book 2+ tickets'. " +
  "A single free ticket (e.g. 'one complimentary ticket up to ₹500 every 6 months'): discount_type flat with discount_value = the cap, uses_per_year accordingly, conditions explaining it. " +
  "Bank offers need valid_to; skip offers with no end date or that already ended, and say so in skipped. Card perks (lasting card benefits) have no valid_to. " +
  "Skip (and list in skipped): headline rates like 'up to 35%' where the actual rate for a normal booking isn't stated; offers tied to personal dates (birthday week, anniversary); first-time-user-only offers; " +
  "offers for a subset of a shop the app can't detect (live events but not movies, international only, Luxe/premium sections, partner restaurants only, select products only); and business or corporate card offers. " +
  "For a percent discount, give max_discount whenever the page states a cap; if no cap is stated, say so in conditions. " +
  "Write dates as YYYY-MM-DD ('30th Nov'26' = 2026-11-30). Ids are kebab-case and include the month for bank offers.";

async function extract(
  srcs: string[],
  opts: { focusCard?: KnownCard; quiet?: boolean } = {},
): Promise<Result> {
  const lines: string[] = [];
  const say = (l = "") => (
    lines.push(l),
    opts.quiet ? undefined : console.log(l)
  );
  const blocks: Anthropic.ContentBlockParam[] = [];
  const problems: string[] = [];
  for (const [i, src] of srcs.entries()) {
    console.log(`Reading ${src}`);
    try {
      const s = await loadSource(src);
      if (s.kind === "text" && s.text.length < 600) {
        problems.push(
          `${src} came back almost empty (it loads with JavaScript). Save it as PDF and run it with --source.`,
        );
        continue;
      }
      blocks.push(
        s.kind === "pdf"
          ? {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: s.base64,
              },
              title: `Source ${i + 1}`,
            }
          : {
              type: "text",
              text: `<document index="${i + 1}" source="${src}">\n${s.text}\n</document>`,
            },
      );
    } catch (e) {
      problems.push(
        `Couldn't read ${src}: ${(e as Error).message}. Open it in your browser, save as PDF, and run it with --source.`,
      );
    }
  }
  problems.forEach((p) => say(`⚠ ${p}`));
  const empty: Result = {
    status: "manual",
    why: problems.join(" "),
    offers: [],
    evidence: {},
    duplicates: {},
    flagged: {},
    lines,
    skipped: [],
    notes: [],
  };
  if (!blocks.length) return empty;

  const focus = opts.focusCard
    ? `These are the official pages of ONE card: ${opts.focusCard.name} (id ${opts.focusCard.id}). Submit only its lasting card perks (kind card_perk, cardIds ["${opts.focusCard.id}"]) at shops in the enum, ` +
      "e.g. buy-1-get-1 or free movie tickets, dining discounts at a named app. Skip welcome benefits, milestone vouchers, lounges, insurance and reward rates. An empty list is a fine answer."
    : "Submit the credit-card offers in these documents.";

  console.log(`Extracting with ${MODEL}…`);
  const out = await callTool<{
    offers?: RawOffer[];
    skipped?: string[];
    notes?: string[];
  }>(
    new Anthropic(),
    {
      model: MODEL,
      max_tokens: 12000,
      tools: [submitTool],
      system: BASE_RULES,
      messages: [
        {
          role: "user",
          content: [
            ...blocks,
            {
              type: "text",
              text:
                `${focus}\n\nCards the app knows (id: name, issuer, network):\n` +
                known
                  .map((c) => `${c.id}: ${c.name}, ${c.issuer}, ${c.network}`)
                  .join("\n"),
            },
          ],
        },
      ],
    },
    "submit_offers",
  );

  const source = srcs.join(" + ");
  const knownIds = known.map((c) => c.id);
  const merchantIds = MERCHANTS.map((m) => m.id);
  const existing = loadOffers();
  const accepted: Offer[] = [];
  const evidence: Record<string, string> = {};
  const duplicates: Record<string, string> = {};
  const flagged: Record<string, string[]> = {};
  for (const raw of out.offers ?? []) {
    const offer = toOffer(raw, source);
    if (opts.focusCard && !offer.cardIds?.length)
      offer.cardIds = [opts.focusCard.id];
    const errors = validateOffer(offer, knownIds, merchantIds, issuers);
    if (offer.validTo && offer.validTo < today)
      errors.push(`already ended on ${offer.validTo}`);
    if (errors.length) {
      say(`✗ Dropped "${raw.title}": ${errors.join("; ")}`);
      continue;
    }
    const dup = findDuplicate(offer, [...existing, ...accepted]);
    if (dup) duplicates[offer.id] = dup.id;
    accepted.push(offer);
    evidence[offer.id] = raw.evidence;
    const w = warnings(offer, raw.evidence ?? "");
    if (w.length) flagged[offer.id] = w;
  }
  for (const o of accepted) {
    describe(o).forEach((l) => say(l));
    say(`    Evidence: "${evidence[o.id]}"`);
    for (const w of flagged[o.id] ?? []) say(`    ⚠ ${w}`);
    if (duplicates[o.id])
      say(
        `    ⚠ Looks like a duplicate of ${duplicates[o.id]} (same cards, shop and deal). Won't be applied unless you remove it from ${duplicates[o.id]} first.`,
      );
    else if (existing.some((e) => e.id === o.id))
      say("    (replaces the saved offer with the same id)");
    say("");
  }
  if (out.skipped?.length)
    say("  Skipped:\n" + out.skipped.map((s) => `    - ${s}`).join("\n"));
  if (out.notes?.length)
    say("  Notes:\n" + out.notes.map((s) => `    - ${s}`).join("\n"));
  const fresh = accepted.filter((o) => !duplicates[o.id]);
  const anyFlagged = fresh.some((o) => flagged[o.id]);
  const status: Result["status"] = fresh.length
    ? problems.length || anyFlagged
      ? "manual"
      : "ready"
    : problems.length
      ? "manual"
      : "none";
  return {
    status,
    why: problems.length
      ? problems.join(" ")
      : anyFlagged
        ? "some offers have warnings (see ⚠ lines); apply the good ones with --apply-ids"
        : fresh.length
          ? undefined
          : accepted.length
            ? "only duplicates of offers you already have"
            : "no credit-card offers for shops the app knows",
    offers: accepted,
    evidence,
    duplicates,
    flagged,
    lines,
    skipped: out.skipped ?? [],
    notes: out.notes ?? [],
  };
}

function saveProposal(slug: string, r: Result) {
  fs.mkdirSync(PROPOSED_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(PROPOSED_DIR, `${slug}.json`),
    JSON.stringify(
      {
        offers: r.offers,
        evidence: r.evidence,
        duplicates: r.duplicates,
        flagged: r.flagged,
        skipped: r.skipped,
        notes: r.notes,
      },
      null,
      2,
    ) + "\n",
  );
}

async function runMany(
  jobs: {
    slug: string;
    label: string;
    srcs: string[];
    focusCard?: KnownCard;
  }[],
  title: string,
) {
  console.log(
    `${title}: ${jobs.length} page set(s). Uses Claude, roughly $0.05–0.20 each.\n`,
  );
  const ready: string[] = [];
  const manual: string[] = [];
  const none: string[] = [];
  const sections: string[] = [];
  for (const [i, job] of jobs.entries()) {
    console.log(`\n[${i + 1}/${jobs.length}] ${job.label}`);
    let r: Result;
    try {
      r = await extract(job.srcs, { focusCard: job.focusCard, quiet: true });
    } catch (e) {
      r = {
        status: "manual",
        why: `failed: ${(e as Error).message}`,
        offers: [],
        evidence: {},
        duplicates: {},
        flagged: {},
        lines: [],
        skipped: [],
        notes: [],
      };
    }
    if (r.offers.length) saveProposal(job.slug, r);
    const tag =
      r.status === "ready"
        ? "READY"
        : r.status === "manual"
          ? "NEEDS A MANUAL LOOK"
          : "NOTHING FOUND";
    console.log(
      `  → ${tag}${r.offers.length ? `, ${r.offers.length} offer(s)` : ""}${r.why ? ` (${r.why})` : ""}`,
    );
    (r.status === "ready" ? ready : r.status === "manual" ? manual : none).push(
      job.slug,
    );
    sections.push(
      `## ${job.label} (${job.slug}): ${tag}`,
      "",
      ...(r.why ? [r.why, ""] : []),
      `Source: ${job.srcs.join(", ")}`,
      "",
      ...(r.lines.length ? ["```", ...r.lines, "```", ""] : []),
    );
  }
  fs.mkdirSync(PROPOSED_DIR, { recursive: true });
  const prev = readJson<string[]>(READY_PATH, []);
  fs.writeFileSync(
    READY_PATH,
    JSON.stringify([...new Set([...prev, ...ready])], null, 2) + "\n",
  );
  const report = [
    `# Offers to review (${today}): ${title}`,
    "",
    `- Ready (${ready.length}): ${ready.join(", ") || "none"}`,
    `- Needs a manual look (${manual.length}): ${manual.join(", ") || "none"}`,
    `- Nothing found (${none.length}): ${none.join(", ") || "none"}`,
    "",
    "Check each ready one against its page (edit data/proposed/<slug>.json if a number is off), then:",
    "",
    "    npm run offers -- --apply-ready",
    "",
    "For pages needing a manual look: open the page in your browser, Ctrl+P → Save as PDF, then",
    "",
    '    npm run offers -- --source "C:\\path\\to\\page.pdf" --name <slug>',
    "",
    ...sections,
  ];
  const file = path.join(
    PROPOSED_DIR,
    args.perks ? "REVIEW-perks.md" : "REVIEW-offers.md",
  );
  fs.writeFileSync(file, report.join("\n"));
  console.log(
    `\nReady: ${ready.length} · Manual: ${manual.length} · Nothing found: ${none.length}`,
  );
  console.log(`Review file: ${path.relative(ROOT, file)}`);
}

/** Apply single offers by id, from any proposal file. */
function applyIds(ids: string[]) {
  const files = fs.existsSync(PROPOSED_DIR)
    ? fs
        .readdirSync(PROPOSED_DIR)
        .filter(
          (f) =>
            /^(offers|perks)-.*\.json$/.test(f) && f !== "offers-ready.json",
        )
    : [];
  const found: Offer[] = [];
  for (const f of files) {
    const { offers } = JSON.parse(
      fs.readFileSync(path.join(PROPOSED_DIR, f), "utf8"),
    ) as { offers?: Offer[] };
    for (const o of offers ?? [])
      if (ids.includes(o.id) && !found.some((x) => x.id === o.id))
        found.push(o);
  }
  const missing = ids.filter((id) => !found.some((o) => o.id === id));
  if (missing.length)
    console.log(`✗ Not found in data/proposed: ${missing.join(", ")}`);
  saveOffers(found);
}

function apply(slugs: string[]) {
  const picked: Offer[] = [];
  for (const slug of slugs) {
    const file = path.join(
      PROPOSED_DIR,
      slug.endsWith(".json") ? slug : `${slug}.json`,
    );
    if (!fs.existsSync(file)) {
      console.log(`✗ No proposal at ${path.relative(ROOT, file)}`);
      continue;
    }
    picked.push(
      ...((JSON.parse(fs.readFileSync(file, "utf8")) as { offers: Offer[] })
        .offers ?? []),
    );
  }
  saveOffers(picked);
}

function saveOffers(offers: Offer[]) {
  const all = loadOffers();
  const merchantIds = MERCHANTS.map((m) => m.id);
  let changed = 0;
  for (const o of offers) {
    const errors = validateOffer(
      o,
      known.map((c) => c.id),
      merchantIds,
      issuers,
    );
    if (errors.length) {
      console.log(
        `✗ ${o.id}: ${errors.join("; ")} (fix its proposal file and apply again)`,
      );
      continue;
    }
    const dup = findDuplicate(o, all);
    if (dup && !args.force) {
      console.log(
        `· Skipped ${o.id}: same as ${dup.id}, which is already saved`,
      );
      continue;
    }
    const i = all.findIndex((x) => x.id === o.id);
    if (i >= 0) all[i] = o;
    else all.push(o);
    changed++;
    console.log(`✓ ${i >= 0 ? "Updated" : "Added"} ${o.id}`);
  }
  fs.writeFileSync(OFFERS_PATH, JSON.stringify(all, null, 2) + "\n");
  console.log(
    `\n${changed} offer(s) saved. data/offers.json now has ${all.length}. Run npm test, then commit and push.`,
  );
}

function status() {
  const all = loadOffers();
  if (!all.length)
    return console.log("No offers yet. Try: npm run offers -- --batch");
  for (const o of [...all].sort((a, b) =>
    (a.validTo ?? "9999").localeCompare(b.validTo ?? "9999"),
  )) {
    const state =
      o.validTo && o.validTo < today
        ? "EXPIRED "
        : o.validFrom && o.validFrom > today
          ? "UPCOMING"
          : "LIVE    ";
    console.log(
      `${state} ${o.id}  ${o.kind === "card_perk" ? "(card perk)" : `ends ${o.validTo}`}  checked ${o.lastVerified}`,
    );
  }
  const expired = all.filter((o) => o.validTo && o.validTo < today).length;
  if (expired)
    console.log(
      `\n${expired} expired. Remove them with: npm run offers -- --prune`,
    );
}

function prune() {
  const all = loadOffers();
  const keep = all.filter((o) => !o.validTo || o.validTo >= today);
  fs.writeFileSync(OFFERS_PATH, JSON.stringify(keep, null, 2) + "\n");
  console.log(
    `Removed ${all.length - keep.length} expired offer(s); ${keep.length} left.`,
  );
}

/** A card's own pages: catalog sources, then cards.json sources that aren't marked secondary. */
function cardPages(c: Card): string[] {
  const fromCatalog = catalog.find((x) => x.id === c.id)?.sources ?? [];
  const fromCard = c.sources
    .filter((s) => !/secondary/i.test(s.label))
    .map((s) => s.url);
  return [...new Set([...fromCatalog, ...fromCard])];
}

(async () => {
  if (args.status) return status();
  if (args.prune) return prune();
  if (args["apply-ready"]) {
    const ready = readJson<string[]>(READY_PATH, []);
    if (!ready.length)
      return console.log("Nothing marked ready. Run --batch or --perks first.");
    apply(ready);
    fs.writeFileSync(READY_PATH, "[]\n");
    return;
  }
  if (args["apply-ids"] && args["apply-ids"] !== "true")
    return applyIds(
      args["apply-ids"]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  if (args.apply && args.apply !== "true")
    return apply(
      args.apply
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error("Set ANTHROPIC_API_KEY in .env.local or your shell");
  if (!issuers.length) throw new Error("No cards found in data/cards.json");

  if (args.batch) {
    const list = readJson<SourceEntry[]>(
      args.batch !== "true" ? path.resolve(args.batch) : SOURCES_PATH,
      [],
    );
    if (!list.length) throw new Error("No pages in data/offer-sources.json");
    const only =
      args.only && args.only !== "true" ? args.only.split(",") : null;
    return runMany(
      list
        .filter((s) => !only || only.includes(s.id))
        .map((s) => ({
          slug: `offers-${s.id}`,
          label: s.label,
          srcs: [s.url],
        })),
      "Offer pages",
    );
  }
  if (args.perks) {
    const only =
      args.only && args.only !== "true" ? args.only.split(",") : null;
    const jobs = cards
      .filter((c) => !only || only.includes(c.id))
      .map((c) => ({
        slug: `perks-${c.id}`,
        label: `${c.name} perks`,
        srcs: cardPages(c),
        focusCard: c as KnownCard,
      }))
      .filter((j) => j.srcs.length);
    return runMany(jobs, "Card perks");
  }

  if (!sources.length)
    throw new Error(
      "Usage: --batch | --perks | --source <url|file> [--name slug] | --apply-ready | --apply <slug,…> | --status | --prune",
    );
  const card =
    args.card && args.card !== "true"
      ? known.find((c) => c.id === args.card)
      : undefined;
  const r = await extract(sources, { focusCard: card });
  if (!r.offers.length)
    return console.log(`\nNothing to save${r.why ? `: ${r.why}` : "."}`);
  const slug =
    args.name && args.name !== "true"
      ? args.name
      : `offers-${r.offers[0].id}`.slice(0, 60);
  saveProposal(slug, r);
  console.log(
    `\nProposal saved to data/proposed/${slug}.json. Check the numbers against the page, then:\n  npm run offers -- --apply ${slug}`,
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
