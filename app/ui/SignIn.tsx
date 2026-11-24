import { recommend } from "@/lib/engine";
import type { Card, Lookup } from "@/lib/types";
import { CardTile } from "./CardTile";
import { cardById } from "./store";
import { Samples, type Sample } from "./Samples";
import { GoogleG, GoogleSignIn, LandingTracking, TryItNow } from "./SignInParts";

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

/**
 * The landing screen. "Try it now" opens the app with no sign-in (works inside WhatsApp's and LinkedIn's browsers,
 * where Google blocks sign-in). Signing in is the second option: it adds AI reading of free text.
 */
export function Landing() {
  const fan = ["flipkart-axis", "swiggy-hdfc", "hsbc-live-plus"].map(cardById).filter((c): c is Card => Boolean(c));
  return (
    <main className="app">
      <LandingTracking />
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
          <div className="onboard-actions landing-actions">
            <TryItNow />
            <GoogleSignIn source="landing" className="btn google wide">
              <GoogleG /> Sign in with Google
            </GoogleSignIn>
          </div>
          <p className="fine center">
            No sign-up needed: your cards and payments stay on this phone. No bank login, ever. Signing in is optional and lets the app read
            anything you type. <a href="/privacy" className="linkish">Privacy policy</a>
          </p>
        </div>
      </div>
    </main>
  );
}
