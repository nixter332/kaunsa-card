/**
 * Card details agent: reads a card's issuer page(s) and proposes its fees, fee waiver, welcome benefit,
 * lounge access, forex markup and income requirement for data/card-profiles.json.
 * The card advisor needs these. Nothing goes live without --apply.
 *
 *   npm run profiles -- --card <id> [--source <url|file>]...   one card (sources default to the card's pages)
 *   npm run profiles -- --pending                              every card that has no details yet
 *   npm run profiles -- --apply <id>[,<id>...]                  save reviewed proposals
 *   npm run profiles -- --status                               which cards have details, and when they were checked
 */
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { validateProfile } from "../lib/advisor";
import { callTool } from "../lib/toolCall";
import type { Card, CardProfile } from "../lib/types";

const ROOT = path.resolve(__dirname, "..");
const PROFILES_PATH = path.join(ROOT, "data/card-profiles.json");
const PROPOSED_DIR = path.join(ROOT, "data/proposed");
const MODEL = process.env.ANTHROPIC_EXTRACT_MODEL ?? "claude-sonnet-5-5";
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

const sourcesArg: string[] = [];
const args: Record<string, string> = {};
process.argv.slice(2).forEach((a, i, all) => {
  if (!a.startsWith("--")) return;
  const value = all[i + 1] === undefined || all[i + 1].startsWith("--") ? "true" : all[i + 1];
  if (a === "--source") sourcesArg.push(value);
  else args[a.slice(2)] = value;
});

type CatalogEntry = { id: string; name: string; issuer: string; sources?: string[] };
const readJson = <T,>(p: string, fallback: T): T => (fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as T) : fallback);
const cards = readJson<Card[]>(path.join(ROOT, "data/cards.json"), []);
const catalog = readJson<CatalogEntry[]>(path.join(ROOT, "data/catalog.json"), []);
const loadProfiles = () => readJson<CardProfile[]>(PROFILES_PATH, []);
const proposalPath = (id: string) => path.join(PROPOSED_DIR, `profile-${id}.json`);
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** The card's own pages: catalog sources first, then cards.json sources that aren't marked secondary. */
function defaultSources(card: Card): string[] {
  const fromCatalog = catalog.find((c) => c.id === card.id)?.sources ?? [];
  const fromCard = card.sources.filter((s) => !/secondary/i.test(s.label)).map((s) => s.url);
  return [...new Set([...fromCatalog, ...fromCard])];
}

async function loadSource(src: string): Promise<{ kind: "pdf"; base64: string } | { kind: "text"; text: string }> {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { headers: { "User-Agent": "Mozilla/5.0 (Kaunsa Card details reader)" } });
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

const field = (type: string, description: string) => ({ type, description });
const submitTool: Anthropic.Tool = {
  name: "submit_card_details",
  description: "Submit the card's fees and non-reward details.",
  input_schema: {
    type: "object",
    properties: {
      document_states_fees: field("boolean", "true only if the documents state the joining and annual fee"),
      joining_fee: field("number", "₹ before GST; 0 if free"),
      annual_fee: field("number", "₹ per year before GST; 0 if lifetime free"),
      fee_waiver_spend: field("number", "₹ spent in a year that waives the annual fee, if stated"),
      welcome_text: field("string", "One short line, e.g. '₹500 Swiggy voucher on first spend within 30 days'"),
      welcome_value_inr: field("number", "Rupee value of the welcome benefit, only if it is clearly stated"),
      lounge_domestic: field("number", "Free domestic lounge visits per year (per quarter × 4). 99 = unlimited. Omit if none"),
      lounge_international: field("number", "Free international lounge visits per year. 99 = unlimited. Omit if none"),
      lounge_note: field("string", "Conditions, e.g. 'needs ₹50,000 spend in the previous quarter'"),
      forex_markup_pct: field("number", "e.g. 3.5 for 3.5%"),
      min_income_monthly: field("number", "₹ per month for salaried applicants. Convert annual figures (÷12). Omit if not stated"),
      highlights: { type: "array", items: { type: "string" }, description: "Up to 3 short non-reward perks (fuel surcharge waiver, movie offers, insurance). No reward rates." },
      evidence: { type: "array", items: { type: "string" }, description: "Short verbatim quotes for each number you give" },
      notes: { type: "array", items: { type: "string" }, description: "Anything unclear, missing or conditional" },
    },
    required: ["document_states_fees", "joining_fee", "annual_fee", "evidence"],
  },
};

type Raw = {
  document_states_fees: boolean;
  joining_fee: number;
  annual_fee: number;
  fee_waiver_spend?: number;
  welcome_text?: string;
  welcome_value_inr?: number;
  lounge_domestic?: number;
  lounge_international?: number;
  lounge_note?: string;
  forex_markup_pct?: number;
  min_income_monthly?: number;
  highlights?: string[];
  evidence: string[];
  notes?: string[];
};

function describe(p: CardProfile): string[] {
  const lounge = p.lounge
    ? [p.lounge.domestic && `${p.lounge.domestic === 99 ? "unlimited" : p.lounge.domestic} domestic`, p.lounge.international && `${p.lounge.international === 99 ? "unlimited" : p.lounge.international} international`]
        .filter(Boolean)
        .join(", ") + (p.lounge.note ? ` (${p.lounge.note})` : "")
    : "none stated";
  return [
    `  Joining fee: ${rupees(p.joiningFee)}   Annual fee: ${rupees(p.annualFee)}${p.feeWaiverSpend ? `, waived on ${rupees(p.feeWaiverSpend)}/yr spend` : ""}  (+ GST)`,
    `  Welcome: ${p.welcome ? `${p.welcome.text}${p.welcome.valueInr ? ` (≈${rupees(p.welcome.valueInr)})` : ""}` : "none stated"}`,
    `  Lounges per year: ${lounge}`,
    `  Forex markup: ${p.forexMarkupPct !== undefined ? `${p.forexMarkupPct}%` : "not stated"}   Min income: ${p.minIncomeMonthly ? `${rupees(p.minIncomeMonthly)}/month` : "not stated"}`,
    ...(p.notIssued ? ["  No longer issued to new applicants"] : []),
    ...(p.highlights?.length ? [`  Also: ${p.highlights.join("; ")}`] : []),
  ];
}

async function extract(cardId: string, srcs: string[]): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  const say = (l = "") => (lines.push(l), console.log(l));
  const card = cards.find((c) => c.id === cardId);
  if (!card) throw new Error(`Unknown card "${cardId}". Add its rules first (npm run extract).`);
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const [i, src] of srcs.entries()) {
    console.log(`Reading source ${i + 1}/${srcs.length}: ${src}`);
    try {
      const s = await loadSource(src);
      if (s.kind === "text" && s.text.length < 1500) {
        say(`⚠ ${src} came back almost empty (loads with JavaScript?). Save it as PDF and pass it with --source.`);
        continue;
      }
      blocks.push(
        s.kind === "pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: s.base64 }, title: `Source ${i + 1}` }
          : { type: "text", text: `<document index="${i + 1}" source="${src}">\n${s.text}\n</document>` },
      );
    } catch (e) {
      say(`⚠ Couldn't read ${src}: ${(e as Error).message}. Save it as PDF and pass it with --source.`);
    }
  }
  if (!blocks.length) return { ok: false, lines: [...lines, "No readable source."] };

  console.log(`Reading card details for ${card.name} with ${MODEL}…`);
  const out = await callTool<Raw>(
    new Anthropic(),
    {
      model: MODEL,
      max_tokens: 4000,
      tools: [submitTool],
      system:
        "You extract an Indian credit card's fees and non-reward benefits from issuer documents. Use ONLY what the documents state; never guess. " +
        "Always respond by calling the submit_card_details tool exactly once; never reply in plain text. " +
        "Fees are before GST. 'Lifetime free' = 0 joining and 0 annual. If the first-year fee differs from renewal, joining_fee is the first-year fee and annual_fee the renewal fee. " +
        "Lounge visits are per year (multiply per-quarter limits by 4). If a document is mostly about something else, only take what it clearly states about this card. " +
        "If the documents don't state the fees, set document_states_fees false and explain in notes.",
      messages: [{ role: "user", content: [...blocks, { type: "text", text: `Card: ${card.name} (${card.issuer}, ${card.network}). Submit its details.` }] }],
    },
    "submit_card_details",
  );

  const profile: CardProfile = {
    id: card.id,
    joiningFee: Math.max(0, Number(out.joining_fee) || 0),
    annualFee: Math.max(0, Number(out.annual_fee) || 0),
    ...(out.fee_waiver_spend && { feeWaiverSpend: out.fee_waiver_spend }),
    ...(out.welcome_text && { welcome: { text: out.welcome_text, ...(out.welcome_value_inr && { valueInr: out.welcome_value_inr }) } }),
    ...((out.lounge_domestic || out.lounge_international) && {
      lounge: {
        ...(out.lounge_domestic && { domestic: out.lounge_domestic }),
        ...(out.lounge_international && { international: out.lounge_international }),
        ...(out.lounge_note && { note: out.lounge_note }),
      },
    }),
    ...(out.forex_markup_pct !== undefined && { forexMarkupPct: out.forex_markup_pct }),
    ...(out.min_income_monthly && { minIncomeMonthly: Math.round(out.min_income_monthly) }),
    ...(out.highlights?.length && { highlights: out.highlights.slice(0, 3) }),
    sources: srcs,
    lastVerified: today,
  };

  const old = loadProfiles().find((p) => p.id === card.id);
  say(`\n${card.name}${old ? ` (currently checked ${old.lastVerified})` : " (new)"}`);
  describe(profile).forEach((l) => say(l));
  if (old) {
    const before = describe(old);
    const changed = describe(profile).filter((l, i) => l !== before[i]);
    say(changed.length ? `  Changed lines: ${changed.length}` : "  No changes vs saved details.");
  }
  say("  Evidence:");
  out.evidence?.forEach((e) => say(`    "${e}"`));
  out.notes?.forEach((n) => say(`  Note: ${n}`));
  const errors = validateProfile(profile);
  errors.forEach((e) => say(`  ✗ ${e}`));
  if (!out.document_states_fees) say("  ⚠ The documents don't state this card's fees. Find the fees page or MITC PDF and re-run with --source.");

  fs.mkdirSync(PROPOSED_DIR, { recursive: true });
  fs.writeFileSync(proposalPath(card.id), JSON.stringify({ profile, confirmed: out.document_states_fees && !errors.length, evidence: out.evidence, notes: out.notes ?? [] }, null, 2) + "\n");
  say(`  Saved to ${path.relative(ROOT, proposalPath(card.id))}`);
  return { ok: out.document_states_fees && !errors.length, lines };
}

function apply(id: string) {
  const file = proposalPath(id);
  if (!fs.existsSync(file)) throw new Error(`No proposal for ${id}. Run --card ${id} first.`);
  const { profile, confirmed } = JSON.parse(fs.readFileSync(file, "utf8")) as { profile: CardProfile; confirmed: boolean };
  if (!confirmed && !args.force) throw new Error(`The source didn't state ${id}'s fees, so it wasn't applied. Re-run with a fees page, or add --force if you checked it yourself.`);
  const errors = validateProfile(profile);
  if (errors.length) throw new Error(`${id}: ${errors.join("; ")}`);
  const all = loadProfiles().filter((p) => p.id !== id);
  all.push(profile);
  all.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(all, null, 2) + "\n");
  console.log(`✓ ${id} saved`);
}

async function pending() {
  const have = new Set(loadProfiles().map((p) => p.id));
  const todo = cards.filter((c) => !have.has(c.id) && (args.redo || !fs.existsSync(proposalPath(c.id))));
  if (!todo.length) return console.log("Nothing pending. Use --status, or --redo to re-read cards that already have proposals.");
  console.log(`Reading details for ${todo.length} card(s). This uses Claude (roughly $0.05–0.15 per card).\n`);
  const report: string[] = [`# Card details to review (${today})`, "", "Check each against the bank's page, then apply the good ones:", "", "    npm run profiles -- --apply id1,id2,…", ""];
  const ok: string[] = [];
  for (const card of todo) {
    try {
      const r = await extract(card.id, sourcesArg.length ? sourcesArg : defaultSources(card));
      report.push(`## ${card.name} (${card.id}) ${r.ok ? "" : "⚠ NEEDS A BETTER SOURCE"}`, "", "```", ...r.lines, "```", "");
      if (r.ok) ok.push(card.id);
    } catch (e) {
      report.push(`## ${card.name} (${card.id}) ✗ FAILED`, "", (e as Error).message, "");
    }
  }
  const file = path.join(PROPOSED_DIR, "REVIEW-profiles.md");
  report.splice(5, 0, ok.length ? `Ready to apply after review: ${ok.join(",")}` : "None are ready yet.", "");
  fs.writeFileSync(file, report.join("\n"));
  console.log(`\nReview file: ${path.relative(ROOT, file)}${ok.length ? `\nAfter checking: npm run profiles -- --apply ${ok.join(",")}` : ""}`);
}

function status() {
  const profiles = loadProfiles();
  for (const c of cards) {
    const p = profiles.find((x) => x.id === c.id);
    console.log(`${p ? "✓" : "·"} ${c.id.padEnd(24)} ${p ? `checked ${p.lastVerified}, fee ${rupees(p.annualFee)}` : fs.existsSync(proposalPath(c.id)) ? "proposal waiting for --apply" : "no details yet"}`);
  }
}

(async () => {
  if (args.status) return status();
  if (args.apply && args.apply !== "true") {
    for (const id of args.apply.split(",").map((x) => x.trim()).filter(Boolean)) {
      try {
        apply(id);
      } catch (e) {
        console.log(`✗ ${(e as Error).message}`);
      }
    }
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY in .env.local");
  if (args.pending) return pending();
  const id = args.card;
  if (!id || id === "true") throw new Error("Usage: --card <id> [--source …] | --pending | --apply id1,id2 | --status");
  const card = cards.find((c) => c.id === id);
  if (!card) throw new Error(`Unknown card "${id}"`);
  const srcs = sourcesArg.length ? sourcesArg : defaultSources(card);
  if (!srcs.length) throw new Error("No sources for this card. Pass --source <url or file>.");
  const r = await extract(id, srcs);
  console.log(r.ok ? `\nLooks complete. After checking: npm run profiles -- --apply ${id}` : "\nNot ready to apply (see warnings above).");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
