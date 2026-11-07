# Kaunsa Card

**Kaunsa Card** ("which card?") is an installable, mobile-first web app that tells Indian multi-card holders which credit card to use for a purchase, in seconds. It accounts for category bonuses, caps, exclusions and UPI eligibility.

> Type "dinner 2400" → **HSBC Live+: ₹240 back (10%)**, with a warning if this month's cap is nearly used up.

## Why

People with 3+ cards default to the same 1–2 cards and lose rewards on everything else. The rules are too complex to remember: merchant bonuses, monthly and quarterly caps, minimum spends, and which cards even work on UPI. See the project brief for the problem, assumptions and roadmap.

## How it works

| Layer | What it does | Where |
| --- | --- | --- |
| Rules data | Reward rules for each card, each with a source link and a "last verified" date | `data/cards.json` |
| Rules engine | Deterministic ranking: eligibility → best matching rule → caps and overflow → ₹ value | `lib/engine.ts` |
| AI lookup | Claude turns free text ("instamart 900 via UPI") into a structured purchase using tool calling. Falls back to an on-device parser if there's no key | `lib/claude.ts`, `app/api/parse` |
| Terms-to-rules agent | Reads an issuer's terms page or PDF, extracts rules with a quote as evidence for each, validates them, and shows a diff for human approval | `scripts/extract-rules.ts` |

**Design rule:** the AI understands and explains, but never invents a reward rate. Every number shown comes from verified rules computed in plain code.

## Run it

```bash
npm install
cp .env.example .env.local      # add your ANTHROPIC_API_KEY (optional for the app)
npm run dev                     # http://localhost:3000
npm test                        # engine, parser and data validation tests
```

Without an API key, the app uses the on-device parser. Everything else works the same.

## Add a new card with the agent

Cards waiting to be added live in `data/catalog.json` (name, issuer, network, official sources, and what to check).

```bash
npm run extract -- --status                 # what's in the app vs waiting
npm run extract -- --card sbi-cashback      # reads every source listed for it, shows a full proposal
npm run extract -- --card sbi-cashback --apply

# or all at once:
npm run extract -- --pending                       # runs every pending card, writes data/proposed/REVIEW.md
npm run extract -- --apply sbi-cashback,axis-ace   # apply the ones that passed review
```

## Update card rules with the agent

```bash
npm run extract -- --card flipkart-axis --source https://www.axis.bank.in/docs/default-source/default-document-library/cashback-tncs---final.pdf
# review the diff + evidence quotes, then:
npm run extract -- --card flipkart-axis --apply
npm test
```

## The app

- **First-run walkthrough:** what it does, pick your cards, see a sample answer.
- **Pay:** type a payment ("zomato 650", "kirana 800 via UPI") or tap a category and enter the amount on a keypad.
- **Result:** the winning card drawn as a card, ₹ back, why, warnings (caps, exclusions, UPI), and every other card compared.
- **My cards:** each card with its monthly/quarterly limits filling up as you log payments.
- **Savings:** ₹ earned this month and ₹ missed by using a different card than the best one.
- Dark mode by default (follows the phone), light mode in Settings, and "Add to Home Screen" to open it like an app.

## Product decisions (v0)

- **No login or bank linking.** Cards and payment history stay in the browser. Less friction and no privacy burden, and still enough to test whether people come back.
- **"I paid with this" fills the caps.** This answers the "is my cap already used up?" question without needing statements.
- **Statement cycles are treated as calendar months and quarters** for now. Setting the statement date per card is next.
- **Every result shows when its rules were last checked, plus a confidence level,** and has a "This looks wrong" button. Trust matters more than coverage.

## Cards in v0

Swiggy HDFC, Flipkart Axis, HSBC Live+, IndusInd Tiger, Scapia Federal (Visa and RuPay). Each card's sources and known gaps are in `data/cards.json`.

*Estimates only, based on issuers' published terms. Not financial advice.*
