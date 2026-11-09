"use client";
// Sample answers on the sign-in screen, so people see what they'd get before signing in.
// Worked out by the same rules engine with three popular cards; no AI, nothing saved or sent.
import { useState } from "react";
import { capture } from "@/lib/analytics";

export type Sample = { id: string; label: string; rows: { cardName: string; valueInr: number; pct: number; why: string }[] };

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function Samples({ samples, cardsLabel }: { samples: Sample[]; cardsLabel: string }) {
  const [pick, setPick] = useState(0);
  const s = samples[pick];
  if (!s) return null;
  const [best, ...rest] = s.rows;
  return (
    <section className="samples" aria-label="Sample answers">
      <div className="chips" role="group" aria-label="Pick a sample payment">
        {samples.map((x, i) => (
          <button
            type="button"
            key={x.id}
            className={`chip${i === pick ? " on" : ""}`}
            aria-pressed={i === pick}
            onClick={() => {
              setPick(i);
              capture("sample_viewed", { sample: x.id });
            }}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="sample-answer" aria-live="polite">
        <p className="sample-best">
          Use <strong>{best.cardName}</strong>: {rupees(best.valueInr)} back ({best.pct}%)
        </p>
        <p className="muted small">{best.why}</p>
        {rest.map((r) => (
          <p key={r.cardName} className="muted small">
            {r.cardName}: {rupees(r.valueInr)} ({r.pct}%)
          </p>
        ))}
      </div>
      <p className="fine center">Example with {cardsLabel}. Sign in to compare your own cards.</p>
    </section>
  );
}
