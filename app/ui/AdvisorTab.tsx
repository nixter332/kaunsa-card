"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { advise, DEFAULT_INPUT, INCOME_BANDS, MIN_GAIN_PER_NEW_CARD, SPEND_BUCKETS, type Advice, type AdvisorInput, type Outcome } from "@/lib/advisor";
import { amountBucket } from "@/lib/analytics";
import type { Card } from "@/lib/types";
import { CardTile } from "./CardTile";
import { ALL_CARDS, ALL_PROFILES, cardById, inr, load, save, track } from "./store";

type Props = { myCards: Card[]; onEditCards: () => void };

const SECTIONS: { status: Outcome["status"]; title: string }[] = [
  { status: "add", title: "Get" },
  { status: "keep", title: "Keep" },
  { status: "drop", title: "Consider closing" },
  { status: "spare", title: "Not needed for your spending" },
];

export function AdvisorTab({ myCards, onEditCards }: Props) {
  const [input, setInput] = useState<AdvisorInput>(DEFAULT_INPUT);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = load<AdvisorInput | null>("cs.advisor", null);
    if (saved) setInput({ ...DEFAULT_INPUT, ...saved, spends: { ...saved.spends } });
  }, []);

  const set = (patch: Partial<AdvisorInput>) => {
    const next = { ...input, ...patch };
    setInput(next);
    save("cs.advisor", next);
    setAdvice(null); // inputs changed: the old answer no longer applies
  };
  const setSpend = (id: string, v: string) => set({ spends: { ...input.spends, [id]: Math.max(0, Math.min(10_00_000, Number(v.replace(/\D/g, "")) || 0)) } });
  const total = useMemo(() => Object.values(input.spends).reduce((s, n) => s + (n || 0), 0), [input.spends]);
  const checked = ALL_PROFILES.length;

  function run() {
    const a = advise(ALL_CARDS, myCards.map((c) => c.id), ALL_PROFILES, input);
    setAdvice(a);
    track("advisor_run", {
      income_band: input.incomeBand,
      total_spend_range: amountBucket(total),
      buckets: SPEND_BUCKETS.filter((b) => (input.spends[b.id] ?? 0) > 0).map((b) => b.id),
      lounge: input.lounge,
      fees: input.fees,
      new_cards: input.newCards,
      prime: input.amazonPrime,
      abroad: input.travelsAbroad,
      cards_held: myCards.length,
      adds: a.outcomes.filter((o) => o.status === "add").map((o) => o.cardId),
      drops: a.outcomes.filter((o) => o.status === "drop").map((o) => o.cardId),
      gain_inr: Math.round(a.gain),
    });
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  return (
    <div className="screen advisor">
      <h1 className="title">Card advisor</h1>
      <p className="muted">Tell it how you spend in a month. It suggests the cards that earn you the most after fees.</p>

      <h3 className="section-title">Your cards</h3>
      <div className="chips">
        {myCards.length === 0 && <span className="muted small">None yet.</span>}
        {myCards.map((c) => (
          <span key={c.id} className="chip static">
            {c.name}
          </span>
        ))}
        <button type="button" className="chip" onClick={onEditCards}>
          {myCards.length ? "Change" : "Add my cards"}
        </button>
      </div>

      <h3 className="section-title">Monthly income</h3>
      <div className="chips" role="group" aria-label="Monthly income">
        {INCOME_BANDS.map((b) => (
          <button type="button" key={b.id} className={`chip${input.incomeBand === b.id ? " on" : ""}`} aria-pressed={input.incomeBand === b.id} onClick={() => set({ incomeBand: b.id })}>
            {b.label}
          </button>
        ))}
      </div>
      <p className="fine">Only used to check which cards you can get.</p>

      <h3 className="section-title">
        Spending in a typical month <span className="spend-total">{inr(total)}</span>
      </h3>
      <ul className="spend-list">
        {SPEND_BUCKETS.map((b) => (
          <li key={b.id}>
            <label htmlFor={`spend-${b.id}`}>
              <strong>{b.label}</strong>
              <small className="muted">{b.hint}</small>
            </label>
            <div className="spend-input">
              <span>₹</span>
              <input
                id={`spend-${b.id}`}
                inputMode="numeric"
                placeholder="0"
                value={input.spends[b.id] ? input.spends[b.id].toLocaleString("en-IN") : ""}
                onChange={(e) => setSpend(b.id, e.target.value)}
              />
            </div>
          </li>
        ))}
      </ul>

      <h3 className="section-title">What matters to you</h3>
      <div className="prefs">
        <div>
          <span className="pref-label">Airport lounges</span>
          <div className="seg" role="group" aria-label="Airport lounges">
            {(
              [
                ["none", "Not needed"],
                ["domestic", "In India"],
                ["international", "Abroad too"],
              ] as const
            ).map(([v, l]) => (
              <button type="button" key={v} className={input.lounge === v ? "on" : ""} onClick={() => set({ lounge: v })}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="pref-label">Card fees</span>
          <div className="seg" role="group" aria-label="Card fees">
            {(
              [
                ["free", "Free only"],
                ["low", "Up to ₹1,000"],
                ["any", "If it pays off"],
              ] as const
            ).map(([v, l]) => (
              <button type="button" key={v} className={input.fees === v ? "on" : ""} onClick={() => set({ fees: v })}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="pref-label">New cards you&apos;re open to</span>
          <div className="seg" role="group" aria-label="New cards you're open to">
            {[0, 1, 2, 3].map((n) => (
              <button type="button" key={n} className={input.newCards === n ? "on" : ""} onClick={() => set({ newCards: n })}>
                {n === 0 ? "None" : n === 3 ? "3" : n}
              </button>
            ))}
          </div>
        </div>
        <label className="toggle-row">
          <span>
            <strong>I have Amazon Prime</strong>
          </span>
          <input type="checkbox" checked={input.amazonPrime} onChange={(e) => set({ amazonPrime: e.target.checked })} />
        </label>
        <label className="toggle-row">
          <span>
            <strong>I travel abroad</strong>
            <small className="muted">Shows each card&apos;s forex markup</small>
          </span>
          <input type="checkbox" checked={input.travelsAbroad} onChange={(e) => set({ travelsAbroad: e.target.checked })} />
        </label>
      </div>

      <button type="button" className="btn primary wide advisor-go" disabled={total === 0} onClick={run}>
        {total === 0 ? "Add your monthly spending first" : "Show my best cards"}
      </button>
      {checked < ALL_CARDS.length && (
        <p className="fine">
          Fees are checked for {checked} of {ALL_CARDS.length} cards so far. Only those can be suggested as new cards.
        </p>
      )}

      <div ref={resultsRef}>{advice && <Results advice={advice} input={input} />}</div>
    </div>
  );
}

function Results({ advice, input }: { advice: Advice; input: AdvisorInput }) {
  const changed = advice.outcomes.some((o) => o.status === "add" || o.status === "drop");
  return (
    <section className="advice" aria-live="polite">
      <div className="stats">
        <div className="stat">
          <span className="stat-num">{inr(advice.current.net)}</span>
          <span className="stat-label">a year with your cards now, after fees</span>
        </div>
        <div className="stat accent">
          <span className="stat-num">{inr(advice.best.net)}</span>
          <span className="stat-label">a year with the suggested cards{advice.gain > 0 ? ` (+${inr(advice.gain)})` : ""}</span>
        </div>
      </div>
      {!changed && <p className="why">Your cards are already the best fit for this spending.</p>}

      {SECTIONS.map(({ status, title }) => {
        const list = advice.outcomes.filter((o) => o.status === status);
        if (!list.length) return null;
        return (
          <div key={status}>
            <h3 className="section-title">{title}</h3>
            <ul className="advice-list">
              {list.map((o) => (
                <AdviceCard key={o.cardId} o={o} input={input} />
              ))}
            </ul>
          </div>
        );
      })}

      <h3 className="section-title">Which card for what</h3>
      <ul className="route-list">
        {advice.best.routing.map((r) => (
          <li key={r.bucketId}>
            <span>{SPEND_BUCKETS.find((b) => b.id === r.bucketId)?.label}</span>
            <span className="route-card">{r.cardId ? cardById(r.cardId)?.name : "Pay from your bank (no card here works on UPI)"}</span>
            <span className="route-val">{r.monthlyValue > 0 ? `${inr(r.monthlyValue)}/mo` : "₹0"}</span>
          </li>
        ))}
      </ul>

      {advice.notes.map((n) => (
        <p key={n} className="warn">
          {n}
        </p>
      ))}
      <p className="fine">
        Estimates for a typical month using each card&apos;s published terms. Fees exclude 18% GST. New cards must add at least {inr(MIN_GAIN_PER_NEW_CARD)} a year to be
        suggested. Approval is up to the bank. This isn&apos;t financial advice.
      </p>
    </section>
  );
}

function AdviceCard({ o, input }: { o: Outcome; input: AdvisorInput }) {
  const card = cardById(o.cardId);
  if (!card) return null;
  const p = o.profile;
  const uses = o.year.buckets.map((id) => SPEND_BUCKETS.find((b) => b.id === id)?.label).filter(Boolean);
  const lounge = p?.lounge
    ? [p.lounge.domestic && `${p.lounge.domestic === 99 ? "Unlimited" : p.lounge.domestic} in India`, p.lounge.international && `${p.lounge.international === 99 ? "unlimited" : p.lounge.international} abroad`]
        .filter(Boolean)
        .join(", ") + " a year"
    : "";
  const facts: [string, string][] = p
    ? [
        ...(o.status === "add" ? ([["Joining fee", p.joiningFee ? inr(p.joiningFee) : "Free"]] as [string, string][]) : []),
        [
          "Annual fee",
          p.annualFee === 0
            ? "Free"
            : `${inr(p.annualFee)}${p.feeWaiverSpend ? `, waived on ${inr(p.feeWaiverSpend)}/yr spend (you'd spend ${inr(o.year.spend)}${o.year.waived ? ", so it's waived" : ""})` : ""}`,
        ],
        ...(p.welcome && o.status === "add" ? ([["Welcome", p.welcome.text]] as [string, string][]) : []),
        ...(lounge ? ([["Lounges", lounge + (p.lounge?.note ? ` (${p.lounge.note})` : "")]] as [string, string][]) : []),
        ...(input.travelsAbroad && p.forexMarkupPct !== undefined ? ([["Forex markup", `${p.forexMarkupPct}%`]] as [string, string][]) : []),
        ...(o.status === "add" && p.minIncomeMonthly ? ([["Income needed", `${inr(p.minIncomeMonthly)}/month`]] as [string, string][]) : []),
      ]
    : [["Fees", "Not checked yet"]];
  return (
    <li className={`advice-card ${o.status}`}>
      <div className="advice-head">
        <CardTile card={card} size="sm" />
        <div>
          <strong>{card.name}</strong>
          <p className="small">{o.why}</p>
          {o.year.rewards > 0 && (
            <p className="advice-num">
              {inr(o.year.rewards)} rewards{o.year.fee ? ` − ${inr(o.year.fee)} fee` : ""} a year
            </p>
          )}
        </div>
      </div>
      {uses.length > 0 && <p className="small muted">Use it for: {uses.join(", ")}</p>}
      <dl className="facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {p?.highlights && o.status === "add" && <p className="small muted">Also: {p.highlights.join(" · ")}</p>}
    </li>
  );
}
