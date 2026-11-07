"use client";
import { MERCHANTS } from "@/lib/localParse";
import { CATEGORIES, type Lookup, type Recommendation } from "@/lib/types";
import { useState } from "react";
import { CardTile } from "./CardTile";
import { cardById, inr, pretty, track } from "./store";

type Props = {
  lookup: Lookup;
  setLookup: (l: Lookup) => void;
  results: Recommendation[];
  parser: string;
  note?: string;
  paidWith: string | null;
  onPaid: (r: Recommendation) => void;
};

export function Result({ lookup, setLookup, results, parser, note, paidWith, onPaid }: Props) {
  const [editing, setEditing] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");
  const [flagged, setFlagged] = useState(false);
  const best = results.find((r) => r.usable);
  const rest = results.filter((r) => r !== best);
  const top = Math.max(best?.valueInr ?? 0, 1);
  const merchant = MERCHANTS.find((m) => m.id === lookup.merchant);
  const bestCard = best && cardById(best.cardId);
  const runnerUp = rest.find((r) => r.usable);
  const gap = best && runnerUp ? best.valueInr - runnerUp.valueInr : 0;

  return (
    <div className="result">
      <button type="button" className="summary" onClick={() => setEditing(!editing)} aria-expanded={editing}>
        <span className="pills">
          <span className="pill">{merchant?.name ?? pretty(lookup.category)}</span>
          <span className="pill">{inr(lookup.amount)}</span>
          <span className="pill">{lookup.rail === "upi" ? "UPI" : lookup.channel === "online" ? "Online" : "In store"}</span>
        </span>
        <span className="summary-edit">{editing ? "Done" : "Edit"}</span>
      </button>
      {parser && !editing && (
        <p className="muted tiny">
          {parser === "claude" ? "Read by Claude." : "Read on this device."} {note}
        </p>
      )}

      {editing && (
        <div className="edit-grid">
          <label>
            <span>Where</span>
            <select
              className="field"
              value={lookup.merchant ?? ""}
              onChange={(e) => {
                const m = MERCHANTS.find((x) => x.id === e.target.value);
                setLookup({ ...lookup, merchant: m?.id, category: m?.category ?? lookup.category, channel: m?.channel ?? lookup.channel });
              }}
            >
              <option value="">Any shop</option>
              {MERCHANTS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Type of spend</span>
            <select className="field" value={lookup.category} onChange={(e) => setLookup({ ...lookup, category: e.target.value as Lookup["category"] })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {pretty(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Amount (₹)</span>
            <input className="field" type="number" inputMode="numeric" min={1} value={lookup.amount} onChange={(e) => setLookup({ ...lookup, amount: Number(e.target.value) || 0 })} />
          </label>
          <div className="seg" role="group" aria-label="How you'll pay">
            {(
              [
                ["Online", { rail: "card", channel: "online" }],
                ["In store", { rail: "card", channel: "offline" }],
                ["UPI", { rail: "upi", channel: "offline" }],
              ] as const
            ).map(([label, v]) => (
              <button
                type="button"
                key={label}
                className={lookup.rail === v.rail && (v.rail === "upi" || lookup.channel === v.channel) ? "on" : ""}
                onClick={() => setLookup({ ...lookup, ...v })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {best && bestCard ? (
        <section className="winner" aria-live="polite">
          <CardTile card={bestCard} size="lg">
            <div className="tile-value">
              <span className="tile-amount">{inr(best.valueInr)}</span>
              <span className="tile-pct">back, {best.effectivePct}%</span>
            </div>
          </CardTile>
          <p className="why">{best.reason}</p>
          {gap > 0 && runnerUp && (
            <p className="muted small">
              {inr(gap)} more than your next best card, {runnerUp.cardName}.
            </p>
          )}
          {best.warnings.map((w) => (
            <p key={w} className="warn">
              {w}
            </p>
          ))}
          <div className="actions">
            <button type="button" className="btn primary" disabled={paidWith === best.cardId} onClick={() => onPaid(best)}>
              {paidWith === best.cardId ? "Payment logged" : "I paid with this card"}
            </button>
          </div>
          <p className="fine">
            Rules checked {best.lastVerified}.{" "}
            {flagged ? (
              <span>Reported. Thanks, this gets checked against the bank&apos;s terms.</span>
            ) : (
              <button type="button" className="linkish" onClick={() => setReportOpen(!reportOpen)} aria-expanded={reportOpen}>
                Report a wrong answer
              </button>
            )}
          </p>
          {reportOpen && !flagged && (
            <form
              className="report"
              onSubmit={(e) => {
                e.preventDefault();
                track("flag_wrong", {
                  comment: reportText.trim().slice(0, 500) || undefined,
                  merchant: lookup.merchant,
                  category: lookup.category,
                  amount: lookup.amount,
                  rail: lookup.rail,
                  channel: lookup.channel,
                  parser,
                  best_card: best.cardId,
                  best_value: best.valueInr,
                  results: results.map((r) => `${r.cardId}:${r.usable ? r.valueInr : "n/a"}`).join(", "),
                });
                setFlagged(true);
                setReportOpen(false);
              }}
            >
              <label htmlFor="report-text" className="small">
                What should it have said? (optional)
              </label>
              <textarea
                id="report-text"
                className="field textarea"
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                placeholder="e.g. Myntra gets 7.5% on my Flipkart Axis card"
                rows={3}
                maxLength={500}
              />
              <button className="btn ghost wide">Send report</button>
            </form>
          )}
        </section>
      ) : (
        <p className="warn">None of your cards can pay this way. UPI needs a RuPay credit card.</p>
      )}

      {rest.length > 0 && (
        <section className="compare" aria-label="Your other cards">
          <h3 className="section-title">Your other cards</h3>
          <ul>
            {rest.map((r) => (
              <li key={r.cardId} className={r.usable ? "" : "dim"}>
                <div className="compare-head">
                  <span className="compare-name">{r.cardName}</span>
                  <span className="compare-val">{r.usable ? inr(r.valueInr) : "Can't use"}</span>
                </div>
                {r.usable && (
                  <div className="bar" aria-hidden="true">
                    <div style={{ width: `${Math.max(2, (r.valueInr / top) * 100)}%` }} />
                  </div>
                )}
                <p className="compare-why">
                  {r.usable ? `${r.effectivePct}%. ${r.reason}` : r.reason}
                </p>
                {r.warnings.map((w) => (
                  <p key={w} className="compare-warn">
                    {w}
                  </p>
                ))}
                {r.usable && (
                  <button type="button" className="linkish small" disabled={paidWith === r.cardId} onClick={() => onPaid(r)}>
                    {paidWith === r.cardId ? "Payment logged" : "I paid with this one instead"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
