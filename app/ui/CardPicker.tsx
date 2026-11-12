"use client";
import { useState } from "react";
import { CONDITIONS } from "@/lib/types";
import { IconCheck } from "./Icons";
import { ALL_CARDS, cardColors, conditionsOf, load, save, track } from "./store";

type Props = {
  selected: string[];
  onToggle: (id: string) => void;
  met: string[];
  onToggleCondition: (key: string) => void;
};

/** Shown first when there's no search, so most people find their cards without scrolling. Our pick, not usage data. */
const POPULAR = [
  "hdfc-millennia",
  "sbi-cashback",
  "amazon-pay-icici",
  "flipkart-axis",
  "swiggy-hdfc",
  "axis-ace",
  "hdfc-regalia-gold",
  "tata-neu-infinity-hdfc",
  "hsbc-live-plus",
  "sbi-simplyclick",
];

export function CardPicker({ selected, onToggle, met, onToggleCondition }: Props) {
  const [search, setSearch] = useState("");
  const [requestText, setRequestText] = useState("");
  const [requested, setRequested] = useState(false);
  const q = search.trim().toLowerCase();
  const rank = (id: string) => (q || !POPULAR.includes(id) ? POPULAR.length : POPULAR.indexOf(id));
  const list = ALL_CARDS.filter((c) => !q || `${c.name} ${c.issuer} ${c.network} ${c.upi ? "upi rupay" : ""}`.toLowerCase().includes(q)).sort(
    (a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name),
  );

  function requestCard() {
    const name = requestText.trim();
    if (!name) return;
    save("cs.requests", [...load<{ name: string; ts: number }[]>("cs.requests", []), { name, ts: Date.now() }]);
    track("card_request", { name });
    setRequested(true);
    setRequestText("");
  }

  return (
    <div className="picker">
      <input
        className="field search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={`Search ${ALL_CARDS.length} cards: "sbi", "tata", "upi"`}
        aria-label="Search cards"
      />
      <ul className="picker-list">
        {list.map((c, i) => {
          const on = selected.includes(c.id);
          const [a, b] = cardColors(c);
          return (
            <li key={c.id}>
              {!q && i === 0 && <p className="picker-group">Popular</p>}
              {!q && i === POPULAR.length && <p className="picker-group">All cards, A to Z</p>}
              <button type="button" className={`picker-row${on ? " on" : ""}`} aria-pressed={on} onClick={() => onToggle(c.id)}>
                <span className="swatch" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} aria-hidden="true" />
                <span className="picker-text">
                  <strong>{c.name}</strong>
                  <small>
                    {c.issuer}
                    {c.upi ? ", works on UPI" : ""}
                  </small>
                </span>
                <span className="tick" aria-hidden="true">{on && <IconCheck />}</span>
              </button>
              {on &&
                conditionsOf(c).map((cond) => {
                  const key = `${c.id}:${cond}`;
                  return (
                    <label key={cond} className="condition">
                      <input type="checkbox" checked={met.includes(key)} onChange={() => onToggleCondition(key)} />
                      <span>{CONDITIONS[cond]}</span>
                    </label>
                  );
                })}
            </li>
          );
        })}
        {list.length === 0 && <li className="muted small pad">No card matches “{search}”. Request it below.</li>}
      </ul>
      <div className="request">
        <p className="request-title">Don&apos;t see your card?</p>
        {requested ? (
          <p className="muted small">Request noted. The most-requested cards get added first.</p>
        ) : (
          <form
            className="row-form"
            onSubmit={(e) => {
              e.preventDefault();
              requestCard();
            }}
          >
            <input className="field" value={requestText} onChange={(e) => setRequestText(e.target.value)} placeholder="Card name, e.g. Axis Atlas" aria-label="Card name" />
            <button className="btn ghost" disabled={!requestText.trim()}>
              Request
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
