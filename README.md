# Kaunsa Card

**Kaunsa Card** ("which card?") tells Indian multi-card holders which credit card to use for a payment, in seconds. Type what you're paying for, and it compares every card you carry, including category bonuses, monthly caps, exclusions, UPI support and live bank offers.

> Type `zomato 600` → **HSBC Live+: ₹60 back (10%)**, why it wins, the bank's own words for that rate, and every other card you hold, compared.

**Live:** [kaunsa-card-six.vercel.app](https://kaunsa-card-six.vercel.app) · **Status:** private beta with friends (two waves, November 2026) · Built by Nikhil Philip (product and decisions) with Claude Code (implementation).

## The problem

People with three or more credit cards default to the same one or two and lose rewards on everything else. The rules are too complex to remember: merchant bonuses, monthly and quarterly caps, minimum spends, which cards work on UPI, and bank offers that change every month. Comparison sites help you choose a card to apply for. Nothing helps at the moment of paying.

## Core principle: AI never invents a reward rate

A wrong rate is worse than no answer, because people act on it. So:

- **Claude only reads what you typed** ("instamart 900 via UPI" → merchant, category, amount, payment method). It never sees or produces a rate. If it's unavailable, an on-device parser takes over.
- **Every rate, cap and fee comes from the bank's own documents**, stored in `data/` and computed by plain code (`lib/engine.ts`).
- **Every rule carries the bank's own words.** An automated check (`npm run evidence`, no AI) confirms that each quote appears word for word in the bank's document and states the rate. Today **all 73 rules across 35 cards pass**. Tap "Where's this from?" under any answer to see the quote and the document.
- **Points are valued openly.** A points answer says what one point is worth and what that assumes (for example "1 Reward Point = ₹0.50, for flights and hotels on SmartBuy"), and says when the value is our estimate rather than the bank's.

## How it stays correct

| Safeguard | What it catches |
| --- | --- |
| Evidence check (`npm run evidence`) | A rule whose quote isn't the bank's exact words or doesn't state the rate. Also run inside the data agent, so such a proposal is never applied automatically. |
| Golden answers (`tests/golden.json`, 303 pinned answers) | Any data change that changes an answer people would see. Reviewers read a before → after table, not JSON. |
| Data sweep test | Every card × every spend type × several amounts must give a sane value. Catches slips like 0.25 typed for 0.025. |
| CI on every push and PR | Tests (163), type check and production build must pass before merging. |
| Monthly refresh | On the 1st, a GitHub Action re-reads bank offer pages, checks every card's documents for changes, re-reads only the changed cards, and opens a pull request for human review. |

## The app

- **Pay:** type a payment (`zomato 650`, `kirana 800 via UPI`) or tap a category and enter the amount. Live offers on your cards and your nearly-used bonus limits show up here.
- **Answer:** the best card, ₹ back and why, warnings (caps, minimums, exclusions, limits that depend on other spending), a bank offer if one applies, every other card compared, and "Where's this from?".
- **Playbook (in My cards):** which of your cards wins each kind of spend and each shop, plus a cheat sheet per card: best uses, what earns nothing, limits to watch, perks, and bank-sourced tips. It's the first thing you see after picking your cards.
- **My cards:** each card's monthly and quarterly limits filling up as you log payments.
- **Savings:** ₹ earned this month and ₹ missed by using a different card. Mis-logged payments can be removed.
- **Advisor:** given your monthly spending, which cards to keep, add or drop after fees.
- **Share:** send an answer to a friend on WhatsApp.

Cards and payment history stay in your browser. The server sees only the text of a lookup, your Google name and email, and usage analytics. See the [privacy policy](https://kaunsa-card-six.vercel.app/privacy).

## Product decisions

- **Google sign-in, with sample answers first.** Sign-in keeps the AI cost per person bounded and tells us who uses it. The sign-in screen shows three real sample answers (worked out by the same rules engine, no AI) so people see the value before signing in.
- **No bank linking or statement upload.** It would need consolidated statements across banks; logging "I paid with this card" answers "is my cap used up?" well enough to test whether people come back.
- **Model only what the bank states.** Rounding and whole-₹100 earning are applied only where the bank's terms say so. Where a document is ambiguous, the app stays as is and the gap is written down rather than guessed.
- **Instrument before scaling.** PostHog tracks the sign-in → onboarding → lookup → logged-payment funnel, answer trust (thumbs, "this looks wrong", edits to a misread lookup, "Where's this from?" opens), sharing and retention.

## Coverage

35 cards from 10 issuers (HDFC, SBI, Axis, ICICI, HSBC, IndusInd, Amex, IDFC FIRST, Federal/Scapia and Kiwi partners), 53 merchants, and bank offers refreshed monthly. Each card's sources, notes and known gaps are in `data/cards.json`; open gaps are listed in `CLAUDE.md`.

## How it works

| Layer | What it does | Where |
| --- | --- | --- |
| Card data | Rules, caps, exclusions, point values and the bank's quotes, per card | `data/cards.json` |
| Rules engine | Eligibility → best matching rule → caps and overflow → rounding → ₹ value, plus offers as an instant discount | `lib/engine.ts`, `lib/offers.ts` |
| Lookup parsing | Claude (Haiku 5.5) reads free text with a single tool call; an on-device parser is the fallback | `lib/claude.ts`, `lib/localParse.ts` |
| Data agents | Claude (Sonnet 5.5) reads bank T&Cs and offer pages and proposes structured rules with quotes; a person reviews before anything is applied | `scripts/` |
| Checks | Evidence check, golden answers, data validation | `lib/evidence.ts`, `lib/golden.ts`, `lib/validate.ts` |

Stack: Next.js 16, React 19, TypeScript, Auth.js (Google), PostHog, Upstash, Vercel, Vitest, GitHub Actions.

## Run it locally

```bash
npm install
cp .env.example .env.local   # Google sign-in keys are required; ANTHROPIC_API_KEY is optional
npm run dev                  # http://localhost:3000
npm test                     # tests, including golden answers and the data sweep
npm run golden               # answers that differ from tests/golden.json
npm run evidence             # check every rule's quote against the bank's documents
```

Without an Anthropic key, lookups use the on-device parser and everything else works the same. The data agents (`npm run extract`, `npm run profiles`, `npm run offers`) call Claude and cost money; see `CLAUDE.md` for how they're used and reviewed.

*Estimates based on issuers' published terms. Not financial advice.*
