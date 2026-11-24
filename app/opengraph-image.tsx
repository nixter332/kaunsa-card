// The link preview picture (LinkedIn, WhatsApp, X): 1200×630, made at build time from the app's own data.
// The example answer comes from the rules engine and the card count from data/cards.json, so nothing here is typed
// by hand and it stays true when the data changes.
import { ImageResponse } from "next/og";
import { recommend } from "@/lib/engine";
import type { Card, Lookup } from "@/lib/types";
import { ALL_CARDS, cardById, cardColors, inr } from "./ui/store";

export const alt = "Kaunsa Card: type what you're paying for and see which of your credit cards gives the most back.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FAN = ["flipkart-axis", "swiggy-hdfc", "hsbc-live-plus"];
// Same example as the landing screen's first sample answer.
const EXAMPLE: { label: string; lookup: Lookup } = {
  label: "Zomato ₹600",
  lookup: { merchant: "zomato", category: "food_delivery", amount: 600, channel: "online", rail: "card" },
};

const BG = "#0d1311";
const TEXT = "#e6eeea";
const MUTED = "#8ea39a";
const ACCENT = "#5be0a4";

function Tile({ card, rotate, x, y }: { card: Card; rotate: number; x: number; y: number }) {
  const [a, b] = cardColors(card);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 400,
        height: 252,
        borderRadius: 24,
        padding: "24px 28px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        color: "#fff",
        backgroundImage: `linear-gradient(135deg, ${a}, ${b})`,
        transform: `rotate(${rotate}deg)`,
        boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ width: 52, height: 36, borderRadius: 8, backgroundImage: "linear-gradient(135deg, #f3dfa2, #c9a54f)" }} />
        <div style={{ fontSize: 22, opacity: 0.85 }}>{card.network}</div>
      </div>
      <div style={{ fontSize: 28, opacity: 0.95 }}>{card.name}</div>
    </div>
  );
}

export default function OpenGraphImage() {
  const fan = FAN.map(cardById).filter((c): c is Card => Boolean(c));
  const best = recommend(fan, EXAMPLE.lookup).find((r) => r.usable);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", backgroundColor: BG, color: TEXT, padding: "64px 72px", position: "relative" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 600, justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 30, color: ACCENT, letterSpacing: 1 }}>KAUNSA CARD</div>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 64, lineHeight: 1.08, marginTop: 18 }}>
              <div>Which card</div>
              <div>should I swipe?</div>
            </div>
            <div style={{ fontSize: 30, color: MUTED, marginTop: 22, lineHeight: 1.35 }}>{"Type what you're paying for. See which of your cards gives the most back."}</div>
          </div>
          {best && (
            <div style={{ display: "flex", flexDirection: "column", border: `2px solid ${ACCENT}`, borderRadius: 18, padding: "18px 24px", width: 520 }}>
              <div style={{ fontSize: 24, color: MUTED }}>{EXAMPLE.label}</div>
              <div style={{ fontSize: 34, marginTop: 6 }}>{`${best.cardName}: ${inr(best.totalInr)} back (${best.effectivePct}%)`}</div>
            </div>
          )}
          <div style={{ fontSize: 24, color: MUTED }}>{`${ALL_CARDS.length} Indian cards · banks' own terms · no sign-up`}</div>
        </div>
        <div style={{ display: "flex", position: "relative", width: 460, height: 500 }}>
          {fan[0] && <Tile card={fan[0]} rotate={-8} x={10} y={0} />}
          {fan[1] && <Tile card={fan[1]} rotate={6} x={60} y={110} />}
          {fan[2] && <Tile card={fan[2]} rotate={-2} x={30} y={250} />}
        </div>
      </div>
    ),
    size,
  );
}
