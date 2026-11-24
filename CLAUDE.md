# Kaunsa Card — notes for Claude Code

Read this before changing anything. README.md has the public overview; this file has the decisions and rules behind it.

## What this is and why

A mobile-first web app that tells Indian multi-card holders which credit card to use for a payment ("swiggy 450" → which card, how much back, any bank offer). Live at https://kaunsa-card-six.vercel.app, deployed by Vercel on every push to `main`.

It's a **product-management portfolio project**. The owner (Nikhil) is moving from business analysis into PM, so decisions, metrics and the reasoning behind changes matter as much as the code. When you propose changes, say what user problem each one solves and how we'd measure it.

Users today: ~7 friends in wave 1, wave 2 (20–40 friends via WhatsApp) started 8 Nov 2026. A LinkedIn launch post is planned for mid-November once wave 2 data is in. PostHog, 7–24 Nov: 9 friends reached the sign-in screen and only 5 signed in, and WhatsApp's and LinkedIn's in-app browsers block Google sign-in, which led to guest mode (24 Nov).

## Core principle: AI never invents a reward rate

- Every rate, cap and fee shown comes from `data/*.json`, computed by plain code (`lib/engine.ts`, `lib/advisor.ts`, `lib/offers.ts`).
- Claude is used only to (a) turn free text into a structured lookup (`lib/claude.ts`, `/api/parse`) and (b) run the offline data agents in `scripts/`, which quote evidence from the bank's own document for every number.
- Data changes go through a human review step. Never hand-edit a rate, cap or fee in `data/` without a source URL and a note saying where it came from. If a value comes from a review site rather than the bank, mark the card `confidence: "low"` and say so in `notes`.

## Stack and commands

Next.js 16 (App Router), React 19, TypeScript, vitest, tsx. Auth.js v5 (Google, optional sign-in, JWT sessions; guests use the app without it). PostHog analytics (EU, proxied via `/kc-relay`). Upstash rate limit per Google account. Owner is on Windows/PowerShell.

```
npm run dev          # localhost:3000 (needs .env.local: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, ANTHROPIC_API_KEY)
npm test             # vitest, must stay green
npx tsc --noEmit     # type check
npm run build        # what Vercel runs; check before pushing UI changes
npm run golden       # answers that differ from tests/golden.json; -- --update after checking them (no AI)
npm run evidence     # are rule quotes the bank's words? -- --apply saves verified ones (no AI, reads bank docs)
```

Before every commit: `npm test` and `npx tsc --noEmit` pass. For UI changes also `npm run build`. `.github/workflows/ci.yml` runs all three on every push to `main` and every PR. `tests/data-sweep.test.ts` runs every card through every spend type, so a data slip usually fails there first. UI tests render real components in a simulated browser: start the file with `// @vitest-environment jsdom` and use `@testing-library/react` (see `tests/lookup-once.test.tsx`, which counts events from the on-device log `cs.events`).

## Map of the code

| Area | Files |
| --- | --- |
| Types (Card, Rule, Cap, Offer, CardProfile…) | `lib/types.ts` |
| Rules engine: eligibility → best rule → caps/overflow → ₹ value; offers applied as instant discount, rewards on the net amount | `lib/engine.ts` |
| Bank offers: matching, days, min spend, uses per month/year, EMI-only offers shown as tips, `betterDeal` banner | `lib/offers.ts` |
| Card advisor (keep/add/drop from income, monthly spend, fees, lounges) | `lib/advisor.ts`, `app/ui/AdvisorTab.tsx` |
| Free-text parsing: instant read on the device when the text has a known shop and an amount (`instantRead`, no AI call, parser `instant`); otherwise a Claude tool call, with the offline parser as fallback (`findMerchant`, generic merchants lose to named brands). The Pay screen previews the answer while typing and shows the best card on each category tile | `lib/localParse.ts`, `lib/claude.ts`, `app/ui/PayTab.tsx` |
| Playbook: best card per spend type and shop, per-card cheat sheet (best uses, exclusions, limits, perks, tips), "earns more on" line for base-rate answers | `lib/playbook.ts`, `app/ui/Playbook.tsx` (shown at the top of My cards and right after onboarding) |
| "What your cards are worth": yearly rewards with the held cards used right vs the best single card for everything (`onTheTable`, shares saved spends with the Advisor); shareable cheat sheet picture drawn on the device | `lib/advisor.ts`, `app/ui/OnTheTable.tsx`, `app/ui/cheatSheet.ts` |
| Payments from Gmail (only for accounts in `GMAIL_SYNC_EMAILS`, see `lib/gmailAccess.ts`): on tap, the browser gets a one-hour read-only Gmail token from Google (`app/ui/gmail.ts`), fetches card alert emails, reads them with fixed per-bank patterns (`parseAlert`: HDFC, Axis, HSBC, IndusInd, Scapia in SMS and email wording; SBI Card and ICICI email) and logs them like "I paid", valued with the limits as they stood at that time (`importAlerts`). Cards are matched by the only card from that issuer, then the network word, then learned last 4 digits; otherwise the app asks once. Emails and the token never reach our server | `lib/alerts.ts`, `lib/importAlerts.ts`, `app/ui/gmail.ts`, `app/ui/GmailSync.tsx` |
| Data validation | `lib/validate.ts` |
| UI | `app/ui/*` (App.tsx is the client shell; page.tsx is the server component that picks the landing screen, the guest app (`kc_guest` cookie, `lib/guest.ts`) or the signed-in app) |
| Analytics events | `lib/analytics.ts` (lookup, answer_vote, offer_missed, advisor_run, paid, offer_tip_shown, offer_tip_code_copied, …) |

### Data

- `data/cards.json`: reward rules for the 35 cards in the app. Each has `sources`, `lastVerified` (`"never"` = not checked against bank terms) and `confidence`. `rule.evidence` is the bank's own words for a rule, written only by `npm run evidence -- --apply` or the rules agent after a word-for-word match; never type one by hand. `card.tips` are bank-sourced only (owner's decision, 12 Nov 2026): write the tip text and the bank's sentence as `quote`, then run `npm run evidence -- --card <id> --apply`, which fills `source` and `checked` or drops the tip if the sentence isn't in the card's documents. Points cards have `reward.valueBasis` (shown to users) and `reward.valueStated` (false = our estimate, so not "high" confidence).
- `tests/golden.json`: 303 pinned answers. A data change that changes an answer fails `npm test` until it's checked and saved with `npm run golden -- --update`.
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

They write proposals and a REVIEW-*.md into `data/proposed/`. A person reviews, then applies. A rule that lists both `merchants` and `categories` matches on EITHER, so an app-only or brand-only rate must list only the merchant (this caused a real bug with Scapia). A rule can carry a one-sentence `note`, shown with the answer whenever it applies, for limits the fields can't express.

### Monthly automation

`.github/workflows/offers-monthly.yml` runs on the 1st (09:00 IST): prunes expired offers, re-reads offer pages, adds confident offers, then checks every card's issuer documents for changes and re-reads only changed cards. It opens a PR "Monthly refresh: review and merge" that the owner reviews and merges. The PR starts with "Answers that changed" (golden answers before → after) and ends with the evidence report. A card whose new quotes aren't the bank's exact words is never auto-applied. GitHub secret `ANTHROPIC_API_KEY` is set. The PR is opened by GitHub's bot, so CI doesn't run on it; the job's own test step labels it `tests-failing`, and the owner merges it with the ruleset's admin bypass.

## Hard rules

- Never commit secrets. `.env.local` stays local. Don't print or log API keys.
- Don't change `app/privacy/contact.ts` (holds the owner's real contact email).
- Don't weaken the "AI never invents a rate" principle or the review step without the owner agreeing.
- Guest mode (owner's decision, 24 Nov 2026): the landing screen's main button is "Try it now"; guests can add cards, run lookups and use the playbook, cheat sheet and Advisor, all stored in localStorage. Guests read text on the device only (`instantRead`, then `localParse`); `/api/parse` (Claude) stays sign-in only and rate-limited, so guests cost nothing. Don't open AI lookups or Gmail to guests without the owner. Sign-in is asked for only where it adds something: one light prompt per visit after a lookup the device couldn't fully read (`signin_prompt_shown`, `signin_from_prompt`), plus Settings. The in-app browser warning shows only when someone taps Sign in there (`GoogleSignIn` in `app/ui/SignInParts.tsx`). Guests are anonymous in PostHog (no identify, no person properties); signing in later identifies the same device ID, so earlier guest events join the person.
- Gmail is read only in the browser (owner's decision, 15 Nov 2026: one tap per visit instead of a server-held token, to keep emails off our server). Moving it server-side would break the privacy promise and needs Google's paid security assessment for public use; don't do it without the owner.
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
- Caps that depend on other spending (Airtel Axis 25%/10% Airtel Thanks, super.money 3%, Kiwi's 1%-of-limit) aren't modelled. They show as a rule `note` with the answer, but the ranking still counts the full rate.
- `reward.earning` models per-payment rounding (9 cards) and whole-₹100 earning (Kiwi), each backed by a verified bank quote. Cards whose documents only say "N points per ₹X" (Regalia Gold ₹200, MoneyBack+ ₹200, SimplySave ₹150, Atlas ₹100, and others) are still linear, so a ₹150 Regalia payment shows 3.75 points. Add a block only with a bank sentence saying points are given per complete ₹X; ICICI uses "per ₹100" wording but rounds to the nearest point, so the wording alone isn't enough.
- Evidence: all 73 rules carry the bank's own words (12 Nov 2026). Several rest on saved PDFs in the owner's Downloads folder (Swiggy HDFC, Millennia, Flipkart SBI, SimplyClick, SimplySave, Scapia), which CI can't re-read; record their public URLs when found. For a new or changed rule without a good quote, find the sentence in the bank's document and run `npm run evidence -- --card <id> --quote "<id>/<rule>=<words>" --apply`; it's saved only if it matches word for word and states the rate.
- Eternal SBI: Blinkit is modelled at 5% (10% applies only to beauty and electronics, which the app can't tell apart); its District 10% and the monthly buy-1-get-1 perk are both applied to a movie booking, and the booklet doesn't say whether they combine. Tata Neu Infinity SBI and ICICI Sapphiro have one record each though they're issued on several networks.
- Tata Neu's extra 5% with NeuPass is a tip only: neither bank lists which categories qualify, so it isn't in any rate.
- Onboarding is one step (pick cards, popular ones first; `POPULAR` in `app/ui/CardPicker.tsx` is our pick, not usage data) and lands on the playbook. The landing screen offers "Try it now" first; tapping Sign in inside an in-app browser (WhatsApp, LinkedIn, Instagram, Facebook), where Google blocks sign-in, shows how to open the page in Chrome or Safari instead. `signin_viewed` now means "saw the landing screen" (`landing: "try_first"` from 24 Nov), and `guest_started` is the new top-of-funnel step next to `signin_clicked`.
- No way to reach people outside the app yet. A weekly email or push ("2 offers on your cards end this week") would need the server to know each person's cards, which breaks the "cards stay on your phone" promise, so it needs the owner's decision first. For now the Pay screen flags offers ending within 7 days and notes when monthly limits reset.
- Gmail import is owner-only (owner's decision, 24 Nov 2026): the app is unverified with Google, so anyone reaching the Gmail consent screen sees an "unverified app" warning and counts toward a lifetime cap of 100 users for the whole Google project. `GMAIL_SYNC_EMAILS` (comma-separated, set on Vercel and in `.env.local`) lists who may use it; not set means nobody. `app/page.tsx` checks it on the server (`lib/gmailAccess.ts`) and only then passes `gmailClientId`, so no one else's page can load Google's Gmail script or ask for access; they see nothing about Gmail. "Disconnect Gmail" stays in Settings for anyone already connected. Opening it up needs Google's verification first. Only HDFC, Axis, HSBC, IndusInd, Scapia (owner's real alerts), SBI Card and ICICI (one email each from friends, 15 Nov 2026) are read today; `gmail_synced.unread_senders` shows which banks' alerts weren't readable. Alerts carry no merchant category, so unknown shops ("JIMIS BURGER LLP") are valued as "other" until the person names them: Savings asks "What is Jimis Burger?" once per shop (biggest spend first, `SHOP_KINDS`), re-values those payments (`setShopKind`) and remembers the answer on the phone (`cs.shopKinds`, never sent; `shop_kind_set` sends only the kind and counts). On the owner's first sync 63 of 80 payments were unknown shops. The search also leaves out mail that's never a card payment (`NOT_CARD_PAYMENT` in `lib/alerts.ts`: account debits, account UPI alerts, OTPs, EMI schedules, statements, promotions), which was 73% of what the first sync read. Bank offers aren't applied to imported payments.
- Statement upload / Account Aggregator was deliberately deferred (needs consolidated statements across banks).
