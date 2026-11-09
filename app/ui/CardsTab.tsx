"use client";
import { useState } from "react";
import { MERCHANTS } from "@/lib/localParse";
import { dayList, offersForCards } from "@/lib/offers";
import type { Card, CardState } from "@/lib/types";
import { CardPicker } from "./CardPicker";
import { CardTile } from "./CardTile";
import { IconClose, IconTag } from "./Icons";
import { ALL_OFFERS, inr, offerDeal, offerEnd } from "./store";

type Props = {
  cards: Card[];
  states: Record<string, CardState>;
  selected: string[];
  onToggle: (id: string) => void;
  met: string[];
  onToggleCondition: (key: string) => void;
};

export function CardsTab({ cards, states, selected, onToggle, met, onToggleCondition }: Props) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="title">My cards</h1>
        <button type="button" className="btn ghost small" onClick={() => setEditing(true)}>
          Add or remove
        </button>
      </div>

      {cards.length === 0 && <p className="muted">Add the cards you carry and every lookup compares them.</p>}

      <ul className="wallet">
        {cards.map((card) => (
          <li key={card.id}>
            <CardTile card={card} size="sm" />
            <div className="caps">
              {card.caps.length === 0 && <p className="muted small">No monthly limits on this card&apos;s rewards.</p>}
              {card.caps.map((cap) => {
                const used = (states[card.id]?.capUsed[cap.id] ?? 0) * card.reward.inrPerUnit;
                const total = cap.amount * card.reward.inrPerUnit;
                const pct = Math.min(100, (used / total) * 100);
                return (
                  <div key={cap.id} className="cap">
                    <div className="cap-head">
                      <span>{cap.label}</span>
                      <span className="cap-num">
                        {inr(used)} of {inr(total)}
                      </span>
                    </div>
                    <div className={`bar${pct >= 100 ? " full" : pct >= 80 ? " near" : ""}`} aria-label={`${Math.round(pct)}% used this ${cap.period}`}>
                      <div style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {cards.some((c) => c.caps.length) && <p className="fine">Limits fill up as you log payments, and reset each calendar month or quarter.</p>}

      {cards.length > 0 && <OffersList cards={cards} />}

      {editing && (
        <div className="sheet-backdrop" onClick={() => setEditing(false)}>
          <div className="sheet tall" role="dialog" aria-modal="true" aria-label="Your cards" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>Your cards</h2>
              <button type="button" className="icon-btn" onClick={() => setEditing(false)} aria-label="Close">
                <IconClose />
              </button>
            </div>
            <CardPicker selected={selected} onToggle={onToggle} met={met} onToggleCondition={onToggleCondition} />
            <button type="button" className="btn primary wide sticky" onClick={() => setEditing(false)}>
              Save {selected.length} {selected.length === 1 ? "card" : "cards"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OffersList({ cards }: { cards: Card[] }) {
  const live = offersForCards(ALL_OFFERS, cards, new Date());
  return (
    <section aria-label="Offers on your cards">
      <h3 className="section-title">Offers on your cards</h3>
      {live.length === 0 ? (
        <p className="muted small">No verified offers on your cards right now. We add bank offers as we check them.</p>
      ) : (
        <ul className="offers-list">
          {live.map(({ offer, cards: covered }) => {
            const where = offer.merchants.map((id) => MERCHANTS.find((m) => m.id === id)?.name ?? id).join(", ");
            const end = offerEnd(offer);
            const meta = [
              offer.days?.length && `${dayList(offer.days)} only`,
              offer.payment === "emi" && "no-cost EMI only",
              offer.usesPerMonth && `${offer.usesPerMonth}× a month`,
              offer.usesPerYear && `${offer.usesPerYear}× a year`,
              offer.code && `code ${offer.code}`,
              offer.kind === "card_perk" ? "card perk" : end && `till ${end}`,
            ].filter(Boolean);
            return (
              <li key={offer.id}>
                <p className="o-title">
                  <IconTag /> {where}
                </p>
                <p className="o-deal">{offerDeal(offer)}</p>
                <p className="o-meta">{[covered.map((c) => c.name).join(", "), ...meta].join(" · ")}</p>
                {offer.conditions && <p className="o-meta">{offer.conditions}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
