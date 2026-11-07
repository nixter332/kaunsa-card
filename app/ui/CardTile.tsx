import type { Card } from "@/lib/types";
import { cardColors } from "./store";

/** A card drawn as a card: the visual anchor of the app. */
export function CardTile({ card, size = "md", children }: { card: Card; size?: "sm" | "md" | "lg"; children?: React.ReactNode }) {
  const [a, b] = cardColors(card);
  return (
    <div className={`tile tile-${size}`} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
      <div className="tile-top">
        <span className="tile-chip" aria-hidden="true" />
        <span className="tile-network">{card.network}</span>
      </div>
      {children}
      <div className="tile-name">{card.name}</div>
    </div>
  );
}
