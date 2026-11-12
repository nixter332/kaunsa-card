import { recommend } from "@/lib/engine";
import type { Card, Lookup } from "@/lib/types";
import { signInWithGoogle } from "../actions";
import { CardTile } from "./CardTile";
import { cardById } from "./store";
import { Samples, type Sample } from "./Samples";
import { InAppBrowserNote, SignInButton, SignInTracking } from "./SignInParts";

const SAMPLE_LOOKUPS: { id: string; label: string; lookup: Lookup }[] = [
  // Three payments with three different winners: the point is that no one card wins everywhere.
  { id: "zomato", label: "Zomato ₹600", lookup: { merchant: "zomato", category: "food_delivery", amount: 600, channel: "online", rail: "card" } },
  { id: "myntra", label: "Myntra ₹3,000", lookup: { merchant: "myntra", category: "apparel", amount: 3000, channel: "online", rail: "card" } },
  { id: "amazon", label: "Amazon ₹2,000", lookup: { merchant: "amazon", category: "online_shopping", amount: 2000, channel: "online", rail: "card" } },
];

/** The rules engine's real answers for three popular cards (card rules only, no offers or AI). */
function samples(cards: Card[]): Sample[] {
  return SAMPLE_LOOKUPS.map(({ id, label, lookup }) => ({
    id,
    label,
    rows: recommend(cards, lookup)
      .filter((r) => r.usable)
      .map((r) => ({ cardName: r.cardName, valueInr: r.valueInr, pct: r.effectivePct, why: r.reason })),
  }));
}

export function SignIn() {
  const fan = ["flipkart-axis", "swiggy-hdfc", "hsbc-live-plus"].map(cardById).filter((c): c is Card => Boolean(c));
  return (
    <main className="app">
      <SignInTracking />
      <div className="onboard">
        <div className="onboard-step">
          <div className="fan" aria-hidden="true">
            {fan.map(
              (c, i) =>
                c && (
                  <div key={c.id} className={`fan-${i}`}>
                    <CardTile card={c} size="md" />
                  </div>
                ),
            )}
          </div>
          <h1 className="onboard-title">Kaunsa Card?</h1>
          <p className="onboard-lead">Tell it what you&apos;re paying for. It tells you which of your cards gives the most back, bank offers included.</p>
          <Samples samples={samples(fan)} cardsLabel={fan.map((c) => c.name).join(", ")} />
          <InAppBrowserNote />
          <form action={signInWithGoogle} className="onboard-actions">
            <SignInButton>
              <GoogleG /> Continue with Google
            </SignInButton>
          </form>
          <p className="fine center">
            We only get your name and email, to know who&apos;s using Kaunsa Card. Your cards and payments stay on this phone. No bank login, ever. <a href="/privacy" className="linkish">Privacy policy</a>
          </p>
        </div>
      </div>
    </main>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
