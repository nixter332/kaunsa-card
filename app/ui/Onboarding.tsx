"use client";
import { useMemo, useState } from "react";
import { recommend } from "@/lib/engine";
import type { CardState } from "@/lib/types";
import { CardPicker } from "./CardPicker";
import { CardTile } from "./CardTile";
import { ALL_CARDS, cardById, inr } from "./store";

type Props = {
  selected: string[];
  onToggle: (id: string) => void;
  met: string[];
  onToggleCondition: (key: string) => void;
  states: Record<string, CardState>;
  canInstall: boolean;
  onInstall: () => void;
  onDone: () => void;
};

export function Onboarding({ selected, onToggle, met, onToggleCondition, states, canInstall, onInstall, onDone }: Props) {
  const [step, setStep] = useState(0);
  const demo = useMemo(() => {
    const cards = ALL_CARDS.filter((c) => selected.includes(c.id));
    const best = recommend(cards, { merchant: "restaurant", category: "dining", amount: 2400, channel: "offline", rail: "card" }, states).find((r) => r.usable);
    return best;
  }, [selected, states]);
  const fan = ["flipkart-axis", "swiggy-hdfc", "hsbc-live-plus"].map(cardById).filter(Boolean);

  return (
    <div className="onboard">
      <div className="dots" aria-label={`Step ${step + 1} of 3`}>
        {[0, 1, 2].map((i) => (
          <span key={i} className={i === step ? "on" : ""} />
        ))}
      </div>

      {step === 0 && (
        <div className="onboard-step">
          <div className="fan" aria-hidden="true">
            {fan.map((c, i) => c && (
              <div key={c.id} className={`fan-${i}`}>
                <CardTile card={c} size="md" />
              </div>
            ))}
          </div>
          <h1 className="onboard-title">Kaunsa Card?</h1>
          <p className="onboard-lead">Tell it what you&apos;re paying for. It tells you which of your cards gives the most back.</p>
          <ul className="points">
            <li>Knows each card&apos;s bonus categories, monthly limits and exclusions</li>
            <li>Checks which cards work on UPI</li>
            <li>Your cards stay on this phone. No sign-up, no bank login</li>
          </ul>
          <div className="onboard-actions">
            <button type="button" className="btn primary wide" onClick={() => setStep(1)}>
              Pick my cards
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="onboard-step">
          <h1 className="title">Which cards do you carry?</h1>
          <p className="muted">Pick every credit card you have. You can change this later.</p>
          <CardPicker selected={selected} onToggle={onToggle} met={met} onToggleCondition={onToggleCondition} />
          <div className="onboard-actions sticky">
            <button type="button" className="btn primary wide" disabled={selected.length === 0} onClick={() => setStep(2)}>
              {selected.length === 0 ? "Pick at least one card" : `Continue with ${selected.length} ${selected.length === 1 ? "card" : "cards"}`}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="onboard-step">
          <h1 className="title">Here&apos;s how it works</h1>
          <p className="muted">Say you&apos;re paying {inr(2400)} for dinner at a restaurant:</p>
          {demo && cardById(demo.cardId) ? (
            <div className="demo">
              <CardTile card={cardById(demo.cardId)!} size="lg">
                <div className="tile-value">
                  <span className="tile-amount">{inr(demo.valueInr)}</span>
                  <span className="tile-pct">back, {demo.effectivePct}%</span>
                </div>
              </CardTile>
              <p className="why">{demo.reason}</p>
            </div>
          ) : null}
          <p className="muted">Type any payment, like “zomato 650” or “kirana 800 via UPI”, or tap a category and enter the amount.</p>
          <div className="install-hint">
            {canInstall ? (
              <button type="button" className="btn ghost wide" onClick={onInstall}>
                Add Kaunsa Card to my home screen
              </button>
            ) : (
              <p className="fine">To open it like an app, use your browser&apos;s menu and choose Add to Home Screen.</p>
            )}
          </div>
          <div className="onboard-actions">
            <button type="button" className="btn primary wide" onClick={onDone}>
              Start using Kaunsa Card
            </button>
          </div>
        </div>
      )}

      {step > 0 && (
        <button type="button" className="linkish onboard-back" onClick={() => setStep(step - 1)}>
          Back
        </button>
      )}
    </div>
  );
}
