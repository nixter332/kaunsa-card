// Golden answers (see lib/golden.ts). No AI, no network.
//   npm run golden              list answers that differ from tests/golden.json
//   npm run golden -- --update  save today's answers as the new golden set (after checking them)
//   npm run golden -- --diff    the differences as a markdown table (used in the monthly PR)
import fs from "node:fs";
import path from "node:path";
import cardsJson from "../data/cards.json";
import merchantsJson from "../data/merchants.json";
import { diffGolden, goldenAnswers, goldenTable, type GoldenRow } from "../lib/golden";
import type { Card, Merchant } from "../lib/types";

const FILE = path.resolve(__dirname, "../tests/golden.json");
const cards = cardsJson as Card[];
const now = goldenAnswers(cards, merchantsJson as Merchant[]);
const saved: GoldenRow[] = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : [];
const changes = diffGolden(saved, now);
const arg = process.argv[2];

if (arg === "--update") {
  fs.writeFileSync(FILE, JSON.stringify(now, null, 2) + "\n");
  console.log(`Saved ${now.length} answers to tests/golden.json (${changes.length} changed).`);
} else if (arg === "--diff") {
  console.log(goldenTable(changes, (id) => cards.find((c) => c.id === id)?.name ?? id));
} else {
  console.log(goldenTable(changes, (id) => cards.find((c) => c.id === id)?.name ?? id));
  if (changes.length) console.log("\nIf these are right, run: npm run golden -- --update");
}
