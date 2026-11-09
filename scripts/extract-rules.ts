// Terms-to-rules agent.
// Reads an issuer's rewards page or T&C PDF, asks Claude to extract structured rules,
// validates them, and shows a diff against data/cards.json for a human to approve.
//
//   npx tsx scripts/extract-rules.ts --card flipkart-axis --source https://.../cashback-tncs.pdf
//   npx tsx scripts/extract-rules.ts --card hsbc-live-plus --source ./terms/hsbc.pdf
//   npx tsx scripts/extract-rules.ts --card flipkart-axis --apply      (merge the last proposal)
//   npx tsx scripts/extract-rules.ts --card sbi-cashback               (new card: uses sources from data/catalog.json)
//   npx tsx scripts/extract-rules.ts --status                          (which cards are verified / pending)
//   npx tsx scripts/extract-rules.ts --pending                         (batch: every card not yet in the app → data/proposed/REVIEW.md)
//   npx tsx scripts/extract-rules.ts --apply sbi-cashback,axis-ace     (apply several reviewed proposals)
//   npx tsx scripts/extract-rules.ts --watch                           (monthly: re-read only cards whose issuer documents changed → data/proposed/REVIEW-terms.md)
//   npx tsx scripts/extract-rules.ts --watch --apply-ready             (same, and apply the confident rule changes to data/cards.json)
// --source can be given more than once; all documents are read together.
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { checkQuote } from "../lib/evidence";
import { MERCHANTS } from "../lib/localParse";
import { callTool } from "../lib/toolCall";
import { CATEGORIES, CONDITIONS, type Card } from "../lib/types";
import {
  diffCards,
  isConfirmedByDocument,
  normalizeCard,
  validateCard,
} from "../lib/validate";
import {
  cardsToRecheck,
  diffWatch,
  fingerprint,
  isWatchable,
  unwatchedCards,
  watchText,
  type FetchResult,
  type WatchState,
} from "../lib/termsWatch";
import { pdfText } from "./docText";

const ROOT = path.resolve(__dirname, "..");
const CARDS_PATH = path.join(ROOT, "data/cards.json");
const PROPOSED_DIR = path.join(ROOT, "data/proposed");
const MODEL = process.env.ANTHROPIC_EXTRACT_MODEL ?? "claude-sonnet-5-5";

const sourcesArg: string[] = [];
const args: Record<string, string> = {};
process.argv.slice(2).forEach((a, i, all) => {
  if (!a.startsWith("--")) return;
  const value =
    all[i + 1] === undefined || all[i + 1].startsWith("--")
      ? "true"
      : all[i + 1];
  if (a === "--source") sourcesArg.push(value);
  else args[a.slice(2)] = value;
});

const CATALOG_PATH = path.join(ROOT, "data/catalog.json");
type CatalogEntry = Pick<
  Card,
  "id" | "name" | "issuer" | "network" | "upi" | "reward"
> & { sources: string[]; reviewTips?: string };
const loadCatalog = (): CatalogEntry[] =>
  fs.existsSync(CATALOG_PATH)
    ? JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"))
    : [];

const today = new Date().toISOString().slice(0, 10);
const loadCards = (): Card[] => JSON.parse(fs.readFileSync(CARDS_PATH, "utf8"));

type Source = { kind: "pdf"; base64: string } | { kind: "text"; text: string };

async function loadSource(src: string): Promise<Source> {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, {
      headers: { "User-Agent": "Mozilla/5.0 (cardswipe rules extractor)" },
    });
    if (!res.ok)
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("pdf") || src.toLowerCase().endsWith(".pdf")) {
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
  return { kind: "text", text: src.endsWith(".html") ? htmlToText(raw) : raw };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .slice(0, 150_000);
}

const ruleSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "short kebab-case id" },
    label: { type: "string", description: "e.g. '7.5% on Myntra'" },
    rate: {
      type: "number",
      description:
        "reward units per ₹1. 5% cashback = 0.05; 10 points per ₹100 = 0.10",
    },
    merchants: {
      type: "array",
      items: { type: "string", enum: MERCHANTS.map((m) => m.id) },
    },
    categories: {
      type: "array",
      items: { type: "string", enum: [...CATEGORIES] },
    },
    excludeMerchants: {
      type: "array",
      items: { type: "string", enum: MERCHANTS.map((m) => m.id) },
    },
    channels: {
      type: "array",
      items: { type: "string", enum: ["online", "offline"] },
    },
    rails: {
      type: "array",
      items: { type: "string", enum: ["card", "upi"] },
      description:
        "Set ['upi'] for a UPI-only rate, ['card'] for a card-swipe-only rate.",
    },
    requires: {
      type: "string",
      enum: Object.keys(CONDITIONS),
      description: Object.entries(CONDITIONS)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; "),
    },
    minTxn: { type: "number" },
    capId: { type: "string" },
    note: {
      type: "string",
      description:
        "One short sentence shown to the user whenever this rule applies, for a limit the fields can't express, e.g. 'Capped at 2× the cashback you earn on other spends this month.' Keep the current record's note unless the document contradicts it.",
    },
    evidence: {
      type: "string",
      description:
        "Short verbatim quote from the document that states this rule, or exactly 'KEPT: not covered by document' for a rule kept from the current record.",
    },
  },
  required: ["id", "label", "rate", "evidence"],
};

const submitTool: Anthropic.Tool = {
  name: "submit_card_rules",
  description:
    "Submit the reward rules stated in the document. Only include what the document actually states.",
  input_schema: {
    type: "object",
    properties: {
      network: {
        type: "string",
        enum: ["Visa", "Mastercard", "RuPay"],
        description: "Omit unless the document states it.",
      },
      upi: {
        type: "boolean",
        description:
          "Omit unless the document states it. true only for RuPay cards usable on UPI.",
      },
      reward: {
        type: "object",
        description:
          "Omit unless the document states the reward type and its rupee value.",
        properties: {
          kind: { type: "string", enum: ["cashback", "points"] },
          unitName: { type: "string" },
          inrPerUnit: {
            type: "number",
            description:
              "₹ value of one unit at the most common redemption (cashback = 1)",
          },
          inrPerUnitNote: { type: "string" },
          valueBasis: {
            type: "string",
            description:
              "Points cards: a few words shown to users on what the ₹ value assumes, e.g. 'for flights and hotels on SmartBuy (₹0.20 as statement credit)'.",
          },
          valueStated: {
            type: "boolean",
            description: "true only if the document itself states inrPerUnit.",
          },
        },
        required: ["kind", "unitName", "inrPerUnit"],
      },
      base: {
        type: "object",
        properties: {
          rate: { type: "number" },
          capId: { type: "string" },
          tiers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                upTo: { type: ["number", "null"] },
                rate: { type: "number" },
              },
              required: ["upTo", "rate"],
            },
          },
        },
        required: ["rate"],
      },
      rules: { type: "array", items: ruleSchema },
      caps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            amount: {
              type: "number",
              description: "in reward units per period",
            },
            period: {
              type: "string",
              enum: ["month", "quarter"],
              description: "statement month/quarter map to month/quarter",
            },
            overflow: {
              type: "string",
              enum: ["base", "none"],
              description:
                "what spend beyond the cap earns; 'none' if the document doesn't say",
            },
          },
          required: ["id", "label", "amount", "period", "overflow"],
        },
      },
      exclusions: {
        type: "object",
        properties: {
          categories: {
            type: "array",
            items: {
              type: "string",
              enum: CATEGORIES.filter((c) => c !== "other"),
            },
            description:
              "Only categories the document explicitly excludes. Skip any that don't map cleanly; mention them in notes.",
          },
          merchants: { type: "array", items: { type: "string" } },
        },
        required: ["categories", "merchants"],
      },
      minTxn: { type: "number" },
      notes: {
        type: "array",
        items: { type: "string" },
        description:
          "Caveats, ambiguities, and anything stated but not representable.",
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      document_states_earn_rates: {
        type: "boolean",
        description:
          "true only if the document itself states at least one earn rate for this card (base or bonus). false if it is about fees or other topics.",
      },
    },
    required: [
      "base",
      "rules",
      "caps",
      "exclusions",
      "notes",
      "confidence",
      "document_states_earn_rates",
    ],
  },
};

type Report = {
  cardId: string;
  status: "ready" | "check" | "unconfirmed" | "failed";
  lines: string[];
};

async function extract(cardId: string, srcs: string[]): Promise<Report> {
  const lines: string[] = [];
  const say = (line = "") => {
    lines.push(line);
    console.log(line);
  };
  const existing = loadCards().find((c) => c.id === cardId);
  const catalog = loadCatalog().find((c) => c.id === cardId);
  // A new card starts from its catalog entry (name, issuer, network, reward value) with no rules yet.
  const seed: Card | undefined =
    existing ??
    (catalog && {
      id: catalog.id,
      name: catalog.name,
      issuer: catalog.issuer,
      network: catalog.network,
      upi: catalog.upi,
      reward: catalog.reward,
      base: { rate: 0 },
      rules: [],
      caps: [],
      exclusions: { categories: [], merchants: [] },
      notes: [],
      sources: [],
      lastVerified: "never",
      confidence: "low",
    });
  if (!seed)
    throw new Error(
      `Unknown card "${cardId}". Add it to data/catalog.json first.`,
    );

  const docBlocks: Anthropic.ContentBlockParam[] = [];
  // The same documents as plain text, to check the model's quotes against afterwards.
  const docsForCheck: { source: string; text: string }[] = [];
  for (const [i, src] of srcs.entries()) {
    console.log(`Reading source ${i + 1}/${srcs.length}: ${src}`);
    let source: Source;
    try {
      source = await loadSource(src);
    } catch (e) {
      say(
        `⚠ Couldn't read ${src}: ${(e as Error).message}. Open it in a browser, save it as PDF, and pass it with --source.`,
      );
      continue;
    }
    if (source.kind === "text" && source.text.length < 1500) {
      say(
        `⚠ ${src} came back almost empty (the page probably loads with JavaScript). Save it as PDF and pass it with --source.`,
      );
      continue;
    }
    try {
      docsForCheck.push({
        source: src,
        text: source.kind === "pdf" ? await pdfText(new Uint8Array(Buffer.from(source.base64, "base64"))) : source.text,
      });
    } catch (e) {
      say(`⚠ Couldn't read the text of ${src} to check quotes: ${(e as Error).message}`);
    }
    docBlocks.push(
      source.kind === "pdf"
        ? {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: source.base64,
            },
            title: `Source ${i + 1}`,
          }
        : {
            type: "text",
            text: `<document index="${i + 1}" source="${src}">\n${source.text}\n</document>`,
          },
    );
  }
  if (!docBlocks.length)
    return {
      cardId,
      status: "failed",
      lines: [...lines, "No readable source, so nothing was extracted."],
    };
  const client = new Anthropic();

  console.log(`Extracting rules for ${cardId} with ${MODEL}…`);
  type ExtractedRule = Omit<Card["rules"][number], "evidence"> & { evidence?: string };
  const out = await callTool<
    Omit<Partial<Card>, "rules"> & {
      rules: ExtractedRule[];
      document_states_earn_rates?: boolean;
    }
  >(
    client,
    {
      model: MODEL,
      max_tokens: 16000,
      tools: [submitTool],
      system:
        "You convert Indian credit-card reward terms into structured data. Extract ONLY what the document states. " +
        "Always respond by calling the submit_card_rules tool exactly once; never reply in plain text. " +
        "Never guess a rate or cap; if something is unclear or missing, leave it out and explain it in notes. " +
        "Every rule must carry a short verbatim evidence quote. Map merchants and categories to the given enums; " +
        "if a merchant or category isn't in the enum, describe it in notes instead of forcing a mapping. " +
        "You are updating an existing record: reuse its rule and cap ids when a rule is the same. " +
        "If the current record has a rule the document neither confirms nor contradicts, keep it with evidence " +
        "'KEPT: not covered by document' and say so in notes. Remove a rule only if the document contradicts it. " +
        "Omit network, upi and reward unless the document states them. " +
        "There may be several documents (e.g. original terms plus a later revision): where they conflict, the most recent one wins; say so in notes. " +
        "Some documents cover several card variants; use only the rates for the card named below. " +
        "If a rate depends on the user (e.g. Amazon Prime) or on paying UPI through the card's own app or UPI ID, set 'requires'. " +
        "A rule with no merchants or categories applies to every spend, so only use that together with rails, channels or requires (e.g. a UPI-wide rate). " +
        "A rule matches if EITHER a listed merchant OR a listed category matches. So a rate that only applies on one app or site (e.g. 'on the Scapia app') lists that merchant and NO categories. " +
        "Put the 'all other spends' rate in base (with base.capId if it has a cap), never as a rule. " +
        "If a category earns nothing except through a specific merchant (e.g. bills only via Google Pay or Airtel Thanks), list the category as excluded AND add the merchant rule; the merchant rule wins. " +
        "If the card has separate UPI rates, set rails ['card'] on its other rules. " +
        "Only add caps that a rule or the base actually uses.",
      messages: [
        {
          role: "user",
          content: [
            ...docBlocks,
            {
              type: "text",
              text:
                `Card: ${seed.name} (${seed.issuer}). Submit its reward rules.\n\n` +
                (existing
                  ? `Current record (may be outdated):\n${JSON.stringify({ base: existing.base, rules: existing.rules, caps: existing.caps, exclusions: existing.exclusions, minTxn: existing.minTxn }, null, 2)}`
                  : `This is a new card with no rules yet. Known metadata: network ${seed.network}, works on UPI: ${seed.upi}, reward unit ${seed.reward.unitName} worth ₹${seed.reward.inrPerUnit}.`),
            },
          ],
        },
      ],
    },
    "submit_card_rules",
  );
  out.rules = out.rules ?? [];

  const { document_states_earn_rates, ...fields } = out;
  const confirmed = isConfirmedByDocument(
    document_states_earn_rates,
    out.rules,
  );
  // Every quote must really be in a document and state the rule's rate; only then is it kept as evidence.
  // A rule kept from the old record keeps its old evidence.
  const unverified: string[] = [];
  const rulesWithEvidence: Card["rules"] = out.rules.map(({ evidence, ...r }) => {
    if (!evidence || evidence.startsWith("KEPT")) {
      const old = existing?.rules.find((o) => o.id === r.id)?.evidence;
      return old ? { ...r, evidence: old } : r;
    }
    const c = checkQuote(docsForCheck, evidence, r, { base: fields.base ?? seed.base, reward: fields.reward ?? seed.reward });
    if (c.found && c.hasRate) return { ...r, evidence: { quote: evidence, source: c.source!, checked: today } };
    unverified.push(`${r.label}: ${!c.found ? "quote not found in the documents" : "quote doesn't state this rate"}`);
    return r;
  });
  const proposed: Card = {
    ...seed,
    ...fields,
    // A partial reward from the document keeps the fields it doesn't mention (e.g. valueBasis).
    reward: { ...seed.reward, ...fields.reward },
    rules: rulesWithEvidence,
    // Only stamp today's date if the document actually confirmed the earn rates.
    lastVerified: confirmed ? today : seed.lastVerified,
    sources: confirmed
      ? [
          ...srcs.map((url) => ({
            label: "Issuer document (read by the rules agent)",
            url,
          })),
          ...seed.sources.filter((s) => !srcs.includes(s.url)),
        ]
      : seed.sources,
  } as Card;

  const normalized = normalizeCard(proposed);
  Object.assign(proposed, normalized.card);
  const errors = validateCard(proposed);
  fs.mkdirSync(PROPOSED_DIR, { recursive: true });
  const file = path.join(PROPOSED_DIR, `${cardId}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        proposed,
        confirmed,
        evidence: out.rules.map((r) => ({ rule: r.label, quote: r.evidence })),
      },
      null,
      2,
    ),
  );

  say("\nChanges vs current data:");
  for (const line of diffCards(existing, proposed)) say("  " + line);
  say("\nEvidence:");
  for (const r of out.rules)
    say(
      `  ${r.label}: ${r.evidence?.startsWith("KEPT") ? "(kept, not in document)" : `"${r.evidence}"`}`,
    );
  if (out.notes?.length)
    say("\nNotes from the model:\n  " + out.notes.join("\n  "));
  if (normalized.changes.length)
    say("\nAuto-fixes:\n  " + normalized.changes.join("\n  "));
  if (unverified.length)
    say(
      "\n⚠ Evidence check (no AI): these quotes aren't the bank's exact words or don't state the rate. Check them in the document:\n  " +
        unverified.join("\n  "),
    );
  if (errors.length)
    say(
      "\n⚠ Validation errors (fix before applying):\n  " + errors.join("\n  "),
    );
  if (!confirmed) {
    say(
      "\n⚠ This document doesn't state the card's earn rates, so it can't verify this card." +
        "\n  Nothing will be marked as checked. Try the card's rewards page or benefit guide instead.",
    );
  }
  if (catalog?.reviewTips)
    say(`\nWhat to check for this card: ${catalog.reviewTips}`);
  console.log(
    `\nProposal saved to ${path.relative(ROOT, file)}. Review it, then run with --apply.`,
  );
  return {
    cardId,
    status: !confirmed ? "unconfirmed" : errors.length || unverified.length ? "check" : "ready",
    lines,
  };
}

/** Batch mode: run the agent for every catalog card that isn't in the app yet, one after another. */
async function pending() {
  const inApp = new Set(loadCards().map((c) => c.id));
  const todo = loadCatalog().filter(
    (c) =>
      !inApp.has(c.id) &&
      (args.redo || !fs.existsSync(path.join(PROPOSED_DIR, `${c.id}.json`))),
  );
  if (!todo.length)
    return console.log(
      "Nothing pending. Use --status to see proposals waiting for --apply, or --redo to re-run them.",
    );
  console.log(
    `Running the agent for ${todo.length} cards, one at a time. This takes a few minutes.\n`,
  );
  const reports: Report[] = [];
  for (const [i, c] of todo.entries()) {
    console.log(`\n━━━ ${i + 1}/${todo.length}: ${c.id} ━━━`);
    try {
      reports.push(await extract(c.id, c.sources));
    } catch (e) {
      console.log(`Failed: ${(e as Error).message}`);
      reports.push({
        cardId: c.id,
        status: "failed",
        lines: [`Failed: ${(e as Error).message}`],
      });
    }
  }
  const label = {
    ready: "✓ ready to review",
    check: "⚠ validation errors",
    unconfirmed: "⚠ source didn't confirm rates",
    failed: "✗ failed",
  };
  const md = [
    `# Rules agent batch review (${today})`,
    "",
    "| Card | Result |",
    "| --- | --- |",
    ...reports.map((r) => `| ${r.cardId} | ${label[r.status]} |`),
    "",
    ...reports.flatMap((r) => [
      `## ${r.cardId}: ${label[r.status]}`,
      "",
      "```",
      ...r.lines,
      "```",
      "",
    ]),
  ].join("\n");
  const reviewFile = path.join(PROPOSED_DIR, "REVIEW.md");
  fs.mkdirSync(PROPOSED_DIR, { recursive: true });
  fs.writeFileSync(reviewFile, md);
  console.log("\n━━━ Summary ━━━");
  for (const r of reports)
    console.log(`  ${label[r.status].padEnd(32)} ${r.cardId}`);
  console.log(
    `\nFull review saved to ${path.relative(ROOT, reviewFile)}. Nothing has been applied yet.`,
  );
}

const WATCH_PATH = path.join(ROOT, "data/terms-watch.json");

async function fetchFingerprint(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (cardswipe terms watcher)" },
      redirect: "follow",
    });
    if (!res.ok) return { error: `${res.status} ${res.statusText}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const isPdf =
      (res.headers.get("content-type") ?? "").includes("pdf") ||
      buf.subarray(0, 5).toString() === "%PDF-";
    if (isPdf) return { hash: fingerprint(buf) };
    const text = htmlToText(buf.toString("utf8"));
    if (text.length < 1500)
      return { error: "page came back almost empty (loads with JavaScript)" };
    return { hash: fingerprint(watchText(text)) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Monthly check: fingerprint every issuer document the app's cards came from. On the first run this
 * only records fingerprints. After that, only cards whose documents changed go back through the agent.
 */
async function watch() {
  const cards = loadCards();
  const urls = [
    ...new Set(
      cards.flatMap((c) => c.sources.map((s) => s.url)).filter(isWatchable),
    ),
  ];
  const prev: WatchState = fs.existsSync(WATCH_PATH)
    ? JSON.parse(fs.readFileSync(WATCH_PATH, "utf8"))
    : {};
  console.log(`Checking ${urls.length} issuer pages and PDFs for changes…`);
  const results: Record<string, FetchResult> = {};
  for (const url of urls) {
    results[url] = await fetchFingerprint(url);
    console.log(
      `  ${results[url].hash ? "✓" : "✗"} ${url}${results[url].error ? `  (${results[url].error})` : ""}`,
    );
  }
  const { state, changed, baselined, unreachable } = diffWatch(
    prev,
    results,
    today,
  );
  fs.writeFileSync(WATCH_PATH, JSON.stringify(state, null, 2) + "\n");

  const recheck = cardsToRecheck(cards, changed);
  const reports: (Report & { diff: string[]; applied: boolean })[] = [];
  if (recheck.length && !process.env.ANTHROPIC_API_KEY)
    throw new Error("Set ANTHROPIC_API_KEY to re-read changed cards");
  for (const id of recheck) {
    console.log(`\n━━━ Terms changed: ${id} ━━━`);
    const before = loadCards().find((c) => c.id === id)!;
    const srcs = before.sources.map((s) => s.url).filter(isWatchable);
    let r: Report;
    try {
      r = await extract(id, srcs);
    } catch (e) {
      r = {
        cardId: id,
        status: "failed",
        lines: [`Failed: ${(e as Error).message}`],
      };
    }
    const file = path.join(PROPOSED_DIR, `${id}.json`);
    const proposed = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, "utf8")).proposed as Card)
      : undefined;
    const diff =
      proposed && r.status !== "failed" ? diffCards(before, proposed) : [];
    let applied = false;
    if (args["apply-ready"] && r.status === "ready" && diff.length) {
      try {
        apply(id);
        applied = true;
      } catch (e) {
        r.lines.push(`Not applied: ${(e as Error).message}`);
      }
    }
    reports.push({ ...r, diff, applied });
  }

  const unwatched = unwatchedCards(cards);
  const verdict = (r: (typeof reports)[number]) =>
    r.status === "failed"
      ? "✗ couldn't re-read: check by hand"
      : !r.diff.length
        ? "page changed, rules the same"
        : r.applied
          ? "⚠ rules changed: applied in this PR, check the diff"
          : r.status === "ready"
            ? "⚠ rules changed: proposal ready, not applied"
            : "⚠ rules may have changed: check by hand";
  const md = [
    `## Card terms check (${today})`,
    "",
    urls.length && unreachable.length === urls.length
      ? "> ⚠ Couldn't read any issuer document. Bank sites may be blocking this machine (GitHub's servers are outside India): run `npm run extract -- --watch` on your laptop instead."
      : !Object.keys(prev).length
        ? `First run: recorded fingerprints for ${baselined.length} documents. From next month, any change triggers a re-read.`
        : `${urls.length - unreachable.length} of ${urls.length} documents checked. ${changed.length} changed${baselined.length ? `, ${baselined.length} new` : ""}.`,
    "",
    ...(reports.length
      ? [
          "| Card | Result |",
          "| --- | --- |",
          ...reports.map((r) => `| ${r.cardId} | ${verdict(r)} |`),
          "",
        ]
      : Object.keys(prev).length
        ? ["No card's terms changed this month.", ""]
        : []),
    ...reports
      .filter((r) => r.diff.length || r.status === "failed")
      .flatMap((r) => [
        `### ${r.cardId}`,
        "",
        "```",
        ...(r.diff.length ? r.diff : r.lines.slice(-8)),
        "```",
        "",
      ]),
    ...(unreachable.length
      ? [
          `<details><summary>Couldn't read ${unreachable.length} documents (blocked, moved or JavaScript-only)</summary>`,
          "",
          ...unreachable.map((u) => `- ${u.url}: ${u.error}`),
          "",
          "</details>",
          "",
        ]
      : []),
    ...(unwatched.length
      ? [
          `Not watched (only saved PDFs or review sites as sources): ${unwatched.join(", ")}.`,
          "",
        ]
      : []),
  ].join("\n");
  fs.mkdirSync(PROPOSED_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROPOSED_DIR, "REVIEW-terms.md"), md);
  console.log("\n" + md);
}

function apply(cardId: string) {
  const file = path.join(PROPOSED_DIR, `${cardId}.json`);
  if (!fs.existsSync(file))
    throw new Error(
      `No proposal for ${cardId} yet. Run the agent for it first.`,
    );
  let { proposed, confirmed } = JSON.parse(fs.readFileSync(file, "utf8")) as {
    proposed: Card;
    confirmed?: boolean;
  };
  if (confirmed === false && !args.force) {
    throw new Error(
      "This proposal came from a document that doesn't state earn rates, so it wasn't applied. Use a better source, or add --force.",
    );
  }
  const { card: fixed, changes } = normalizeCard(proposed);
  for (const c of changes) console.log(`  auto-fix (${cardId}): ${c}`);
  const errors = validateCard(fixed);
  if (errors.length)
    throw new Error("Proposal has validation errors:\n" + errors.join("\n"));
  proposed = fixed;
  const cards = loadCards();
  const i = cards.findIndex((c) => c.id === cardId);
  if (i >= 0) cards[i] = proposed;
  else cards.push(proposed);
  fs.writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2) + "\n");
  console.log(
    `Applied ${cardId} to data/cards.json. Run npm test to re-check.`,
  );
}

function status() {
  const cards = loadCards();
  const ids = new Set(cards.map((c) => c.id));
  console.log("In the app:");
  for (const c of cards)
    console.log(
      `  ✓ ${c.id.padEnd(24)} last checked ${c.lastVerified}  (${c.confidence})`,
    );
  const pending = loadCatalog().filter((c) => !ids.has(c.id));
  if (pending.length) {
    console.log("\nNot added yet (run: npm run extract -- --card <id>):");
    for (const c of pending) {
      const hasProposal = fs.existsSync(
        path.join(PROPOSED_DIR, `${c.id}.json`),
      );
      console.log(
        `  · ${c.id.padEnd(24)} ${hasProposal ? "proposal ready, review then --apply" : ""}`,
      );
    }
  }
}

(async () => {
  if (args.status) return status();
  if (args.watch) return watch();
  // --apply id1,id2  or  --card id --apply
  if (args.apply && args.apply !== "true") {
    for (const id of args.apply
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)) {
      try {
        apply(id);
      } catch (e) {
        console.log(`✗ ${id}: ${(e as Error).message}`);
      }
    }
    return;
  }
  if (args.pending) {
    if (!process.env.ANTHROPIC_API_KEY)
      throw new Error("Set ANTHROPIC_API_KEY in .env.local or your shell");
    return pending();
  }
  const cardId = args.card;
  if (!cardId)
    throw new Error(
      "Usage: --card <id> [--source <url|file>]... | --card <id> --apply | --apply id1,id2 | --pending | --status",
    );
  if (args.apply) return apply(cardId);
  const srcs = sourcesArg.length
    ? sourcesArg
    : (loadCatalog().find((c) => c.id === cardId)?.sources ?? []);
  if (!srcs.length)
    throw new Error(
      "Pass --source <url or file> (or add sources for this card to data/catalog.json)",
    );
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error("Set ANTHROPIC_API_KEY in .env.local or your shell");
  await extract(cardId, srcs);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
