# Kaunsa Card — notes for Claude Code

Read this before changing anything. README.md has the public overview; this file has the decisions and rules behind it.

## What this is and why

A mobile-first web app that tells Indian multi-card holders which credit card to use for a payment ("swiggy 450" → which card, how much back, any bank offer). Live at https://kaunsa-card-six.vercel.app, deployed by Vercel on every push to `main`.

It's a **product-management portfolio project**. The owner (Nikhil) is moving from business analysis into PM, so decisions, metrics and the reasoning behind changes matter as much as the code. When you propose changes, say what user problem each one solves and how we'd measure it.

Users today: ~7 friends in wave 1, wave 2 (20–40 friends via WhatsApp) started 8 Nov 2026. A LinkedIn launch post is planned for mid-November once wave 2 data is in.

## Core principle: AI never invents a reward rate

- Every rate, cap and fee shown comes from `data/*.json`, computed by plain code (`lib/engine.ts`, `lib/advisor.ts`, `lib/offers.ts`).
- Claude is used only to (a) turn free text into a structured lookup (`lib/claude.ts`, `/api/parse`) and (b) run the offline data agents in `scripts/`, which quote evidence from the bank's own document for every number.
- Data changes go through a human review step. Never hand-edit a rate, cap or fee in `data/` without a source URL and a note saying where it came from. If a value comes from a review site rather than the bank, mark the card `confidence: "low"` and say so in `notes`.

## Stack and commands

Next.js 16 (App Router), React 19, TypeScript, vitest, tsx. Auth.js v5 (Google, required sign-in, JWT sessions). PostHog analytics (EU, proxied via `/kc-relay`). Upstash rate limit per Google account. Owner is on Windows/PowerShell.

```
npm run dev          # localhost:3000 (needs .env.local: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, ANTHROPIC_API_KEY)
npm test             # vitest, must stay green
npx tsc --noEmit     # type check
npm run build        # what Vercel runs; check before pushing UI changes
```

Before every commit: `npm test` and `npx tsc --noEmit` pass. For UI changes also `npm run build`.

## Map of the code

| Area | Files |
| --- | --- |
| Types (Card, Rule, Cap, Offer, CardProfile…) | `lib/types.ts` |
| Rules engine: eligibility → best rule → caps/overflow → ₹ value; offers applied as instant discount, rewards on the net amount | `lib/engine.ts` |
| Bank offers: matching, days, min spend, uses per month/year, EMI-only offers shown as tips, `betterDeal` banner | `lib/offers.ts` |
| Card advisor (keep/add/drop from income, monthly spend, fees, lounges) | `lib/advisor.ts`, `app/ui/AdvisorTab.tsx` |
| Free-text parsing: Claude tool call + offline fallback (`findMerchant`, generic merchants lose to named brands) | `lib/claude.ts`, `lib/localParse.ts` |
| Data validation | `lib/validate.ts` |
| UI | `app/ui/*` (App.tsx is the client shell; page.tsx is the server component that checks sign-in) |
| Analytics events | `lib/analytics.ts` (lookup, answer_vote, offer_missed, advisor_run, paid, offer_tip_shown, offer_tip_code_copied, …) |

### Data

- `data/cards.json`: reward rules for the 31 cards in the app. Each has `sources`, `lastVerified` (`"never"` = not checked against bank terms) and `confidence`.
- `data/card-profiles.json`: fees, waivers, welcome, lounges, forex, min income, `notIssued` (closed to new applicants; advisor never suggests these).
- `data/catalog.json`: cards waiting to be added, with official sources and `reviewTips` for the agent.
- `data/offers.json`: bank offers and card perks. `data/offer-sources.json`: pages the offers agent reads monthly.
- `data/merchants.json`: merchant ids, categories, aliases. `generic: true` marks catch-alls like "Fuel station".
- `data/terms-watch.json`: fingerprints of every issuer document, written by the monthly job. Don't edit by hand.
- `data/proposed/`: agent output for review. Gitignored.

### Agents (cost money: they call Claude. Ask the owner before running them)

```
npm run extract -- --pending | --card <id> [--source <url|file>] | --apply id1,id2 [--force] | --watch [--apply-ready]
npm run profiles -- --pending | --card <id> | --apply id1,id2 [--force]
npm run offers -- --batch | --perks | --apply-ready | --apply-ids … | --prune
```

They write proposals and a REVIEW-*.md into `data/proposed/`. A person reviews, then applies. A rule that lists both `merchants` and `categories` matches on EITHER, so an app-only or brand-only rate must list only the merchant (this caused a real bug with Scapia).

### Monthly automation

`.github/workflows/offers-monthly.yml` runs on the 1st (09:00 IST): prunes expired offers, re-reads offer pages, adds confident offers, then checks every card's issuer documents for changes and re-reads only changed cards. It opens a PR "Monthly refresh: review and merge" that the owner reviews and merges. GitHub secret `ANTHROPIC_API_KEY` is set.

## Hard rules

- Never commit secrets. `.env.local` stays local. Don't print or log API keys.
- Don't change `app/privacy/contact.ts` (holds the owner's real contact email).
- Don't weaken the "AI never invents a rate" principle, the review step, or the sign-in requirement without the owner agreeing.
- Keep privacy promises true: card list and payment history live in the browser (localStorage); the server only sees the lookup text, Google name/email, and analytics. If a change would send more data anywhere, say so and update `app/privacy/page.tsx`.
- Small commits with clear messages. Explain what you changed and why before pushing. Push to `main` only after tests pass and the owner says go (Vercel deploys immediately).
- Plain, short UI copy. The audience is young Indian professionals on phones.

## Known gaps and backlog (good places to look)

- Airtel Axis District ₹200 offer cap is monthly but applied per payment. Cleartrip 6% offer has no stated cap.
- Advisor ignores milestones, tiers and welcome value when ranking; quarterly caps are approximated as /3 per month.
- IDFC FIRST Millennia's 10X above ₹20k/month and OneCard's dynamic top-2 categories can't be modelled per payment (OneCard not added).
- Scapia cards have no readable issuer source, so the terms watch can't see them. HDFC "contentstream" PDFs time out from both GitHub and the owner's laptop.
- MY Zone base rate and Amex MRCC fees come from review sites (low confidence).
- When someone pays with the card from the "Better deal on EMI" box, there's no one-tap way to log it, and the EMI discount isn't counted in Savings.
- Departmental stores and Bharat Gas have no category or merchant; rules that cover them are partly unmodelled.
- `new-cards.txt`, `profiles-run.txt`, `profiles-sbi.txt` were committed by accident; delete them (`/*.txt` is now gitignored).
- Statement upload / Account Aggregator was deliberately deferred (needs consolidated statements across banks).
