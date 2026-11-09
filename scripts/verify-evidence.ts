// Evidence check: is each rule's quote really in the bank's document, and does it state the rate?
// No AI. Reads every card's issuer sources (pages, PDF links, PDFs saved on this laptop).
//
//   npm run evidence                  report → data/proposed/REVIEW-evidence.md
//   npm run evidence -- --card <id>   one card
//   npm run evidence -- --apply       also save verified quotes into data/cards.json (rule.evidence)
//   npm run evidence -- --card <id> --quote "<id>/<rule>=<bank's words>" --apply
//                                     offer a better quote for one rule; saved only if it checks out
//
// Quotes come from the rule's saved evidence, or from the rules agent's last proposal
// (data/proposed/<card>.json). Review sites are never used as evidence.
import fs from "node:fs";
import path from "node:path";
import { checkQuote } from "../lib/evidence";
import { isWatchable } from "../lib/termsWatch";
import type { Card } from "../lib/types";
import { docText } from "./docText";

const ROOT = path.resolve(__dirname, "..");
const CARDS_PATH = path.join(ROOT, "data/cards.json");
const PROPOSED_DIR = path.join(ROOT, "data/proposed");
const today = new Date().toISOString().slice(0, 10);
const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const only = argv.includes("--card") ? argv[argv.indexOf("--card") + 1] : undefined;
// --quote "<card>/<rule>=<the bank's words>": a person offers a quote; it's saved only if it matches the
// document word for word and states the rate (use "..." between two pieces of the same document).
const offered = new Map(
  argv.flatMap((a, i) => {
    if (a !== "--quote") return [];
    const m = /^([a-z0-9-]+)\/([a-z0-9-]+)=(.+)$/s.exec(argv[i + 1] ?? "");
    if (!m) throw new Error(`--quote needs "card/rule=quote", got: ${argv[i + 1]}`);
    return [[`${m[1]}/${m[2]}`, m[3].trim()] as const];
  }),
);

/** Issuer documents only: web pages and PDFs on the bank's site, or saved PDFs. Not review sites. */
const isIssuerDoc = (src: string) => !/^https?:\/\//i.test(src) || isWatchable(src);

function proposalQuotes(cardId: string): { rule: string; quote?: string }[] {
  const f = path.join(PROPOSED_DIR, `${cardId}.json`);
  if (!fs.existsSync(f)) return [];
  return (JSON.parse(fs.readFileSync(f, "utf8")).evidence ?? []) as { rule: string; quote?: string }[];
}

type Row = { cardId: string; rule: string; result: string; quote?: string };

(async () => {
  const cards: Card[] = JSON.parse(fs.readFileSync(CARDS_PATH, "utf8"));
  const rows: Row[] = [];
  const unreadable: string[] = [];
  const cache = new Map<string, string | null>();
  let saved = 0;

  for (const card of cards) {
    if (only && card.id !== only) continue;
    if (!card.rules.length) continue;
    console.log(`\n${card.id}`);
    const docs: { source: string; text: string }[] = [];
    for (const { url } of card.sources.filter((s) => isIssuerDoc(s.url))) {
      if (!cache.has(url)) {
        try {
          cache.set(url, await docText(url));
          console.log(`  read ${url}`);
        } catch (e) {
          cache.set(url, null);
          unreadable.push(`${url}: ${(e as Error).message}`);
          console.log(`  ✗ ${url}: ${(e as Error).message}`);
        }
      }
      const text = cache.get(url);
      if (text) docs.push({ source: url, text });
    }
    const fromProposal = proposalQuotes(card.id);
    for (const rule of card.rules) {
      const quote = offered.get(`${card.id}/${rule.id}`) ?? rule.evidence?.quote ?? fromProposal.find((e) => e.rule === rule.label)?.quote;
      if (!quote || quote.startsWith("KEPT")) {
        rows.push({ cardId: card.id, rule: rule.label, result: "✗ no quote from the bank (rule was kept from an older record)" });
        continue;
      }
      if (!docs.length) {
        rows.push({ cardId: card.id, rule: rule.label, result: "? couldn't read any issuer document", quote });
        continue;
      }
      const c = checkQuote(docs, quote, rule, card);
      const result = !c.found ? "⚠ quote not found in the bank's documents" : !c.hasRate ? "⚠ quote doesn't state this rate" : "✓ verified";
      rows.push({ cardId: card.id, rule: rule.label, result, quote });
      if (!apply) continue;
      if (c.found && c.hasRate) {
        rule.evidence = { quote, source: c.source!, checked: today };
        saved++;
      } else if (rule.evidence) {
        delete rule.evidence; // the document no longer backs this quote
      }
    }
  }

  const count = (prefix: string) => rows.filter((r) => r.result.startsWith(prefix)).length;
  const md = [
    `# Evidence check (${today})`,
    "",
    `${count("✓")} verified, ${count("⚠")} need a look, ${count("✗")} have no quote, ${count("?")} couldn't be checked. ${apply ? `Saved ${saved} verified quotes to data/cards.json.` : "Nothing saved (run with --apply)."}`,
    "",
    "| Card | Rule | Result | Quote |",
    "| --- | --- | --- | --- |",
    ...rows.filter((r) => !r.result.startsWith("✓")).map((r) => `| ${r.cardId} | ${r.rule} | ${r.result} | ${r.quote ? `"${r.quote.replace(/\|/g, "/").slice(0, 200)}"` : ""} |`),
    "",
    ...(unreadable.length ? ["Couldn't read:", ...unreadable.map((u) => `- ${u}`), ""] : []),
  ].join("\n");
  fs.mkdirSync(PROPOSED_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROPOSED_DIR, "REVIEW-evidence.md"), md);
  if (apply) fs.writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2) + "\n");
  console.log("\n" + md);
})();
