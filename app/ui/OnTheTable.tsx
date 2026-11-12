"use client";
// "What are your cards worth?": rough monthly spends in, ₹ a year out, against using one card for everything.
// Spends are shared with the Advisor (same saved answers) and never leave the phone; analytics get rounded totals only.
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_INPUT, onTheTable, SPEND_BUCKETS, type AdvisorInput } from "@/lib/advisor";
import { amountBucket } from "@/lib/analytics";
import type { Card } from "@/lib/types";
import { shareLink } from "./referral";
import { ALL_PROFILES, cardById, inr, load, save, track } from "./store";

export function OnTheTable({ cards, onToast }: { cards: Card[]; onToast: (msg: string) => void }) {
  const [input, setInput] = useState<AdvisorInput>(DEFAULT_INPUT);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const saved = load<AdvisorInput | null>("cs.advisor", null);
    if (saved) setInput({ ...DEFAULT_INPUT, ...saved, spends: { ...saved.spends } });
  }, []);

  const total = useMemo(() => Object.values(input.spends).reduce((s, n) => s + (n || 0), 0), [input.spends]);
  const result = useMemo(() => (total > 0 ? onTheTable(cards, ALL_PROFILES, input) : null), [cards, input, total]);
  const single = result?.single ? cardById(result.single.cardId) : undefined;

  const setSpend = (id: string, v: string) => {
    const next = { ...input, spends: { ...input.spends, [id]: Math.max(0, Math.min(10_00_000, Number(v.replace(/\D/g, "")) || 0)) } };
    setInput(next);
    save("cs.advisor", next);
  };

  function done() {
    setOpen(false);
    if (!result) return;
    track("table_calculated", {
      total_spend_range: amountBucket(total),
      buckets: SPEND_BUCKETS.filter((b) => (input.spends[b.id] ?? 0) > 0).length,
      cards_held: cards.length,
      best_range: amountBucket(result.best),
      gap_range: amountBucket(result.gap),
    });
  }

  async function share() {
    if (!result) return;
    const text =
      result.gap >= 500
        ? `I was leaving about ${inr(result.gap)} a year on the table by using one credit card for everything. Kaunsa Card shows which of your cards to use where.`
        : `My credit cards can earn about ${inr(result.best)} a year when I use the right one each time. Kaunsa Card shows which card to use where.`;
    const url = shareLink();
    track("share_clicked", { what: "table", gap_range: amountBucket(result.gap) });
    if (navigator.share) {
      try {
        await navigator.share({ text, url });
        track("answer_shared", { what: "table", method: "native" });
      } catch {
        track("answer_share_cancelled", { what: "table" });
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      onToast("Copied. Paste it in WhatsApp.");
      track("answer_shared", { what: "table", method: "copy" });
    } catch {
      onToast("Couldn't copy. Try again.");
    }
  }

  return (
    <section className="table-card" aria-label="What your cards are worth">
      {result && !open ? (
        <>
          <p className="table-label">Your cards, used right</p>
          <p className="table-amount">
            {inr(result.best)} <small>a year</small>
          </p>
          {result.gap >= 100 && single ? (
            <p className="small">
              Using only {single.name} for everything earns {inr(result.single!.rewards)}. That leaves <strong>{inr(result.gap)} a year on the table</strong>.
            </p>
          ) : (
            <p className="small muted">For your spending, one card already gets you nearly all of it.</p>
          )}
          <div className="table-actions">
            <button type="button" className="btn ghost small" onClick={share}>
              Share this
            </button>
            <button type="button" className="linkish small" onClick={() => setOpen(true)}>
              Change my spends
            </button>
          </div>
          <p className="fine">From the monthly spends you entered ({inr(total)} a month), before annual fees. An estimate, not a promise.</p>
        </>
      ) : !open ? (
        <>
          <p className="table-label">What are your cards worth a year?</p>
          <p className="small muted">Enter rough monthly spends and see what using the right card each time adds up to.</p>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              setOpen(true);
              track("table_opened", { cards_held: cards.length });
            }}
          >
            Work it out
          </button>
        </>
      ) : (
        <>
          <p className="table-label">Roughly, what do you spend in a month?</p>
          <p className="fine">Fill in what applies and leave the rest. This stays on your phone.</p>
          <ul className="table-spends">
            {SPEND_BUCKETS.map((b) => (
              <li key={b.id}>
                <label htmlFor={`table-${b.id}`}>{b.label}</label>
                <div className="spend-input">
                  <span>₹</span>
                  <input
                    id={`table-${b.id}`}
                    inputMode="numeric"
                    placeholder="0"
                    value={input.spends[b.id] ? input.spends[b.id].toLocaleString("en-IN") : ""}
                    onChange={(e) => setSpend(b.id, e.target.value)}
                  />
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="btn primary wide" disabled={total === 0} onClick={done}>
            {total === 0 ? "Enter at least one spend" : "Show what my cards are worth"}
          </button>
        </>
      )}
    </section>
  );
}
