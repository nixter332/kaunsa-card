"use client";
// "Your playbook": which of your cards wins each kind of spend, and how to get the most from each card.
// Everything here comes from lib/playbook.ts (the same rules engine as lookups); nothing is typed in by hand.
import { useEffect, useMemo } from "react";
import { MERCHANTS } from "@/lib/localParse";
import { bestByShop, bestBySpend, cardSheet, PLAYBOOK_SPENDS, type PlaybookRow } from "@/lib/playbook";
import type { Card, Lookup } from "@/lib/types";
import { ALL_OFFERS, ALL_PROFILES, track } from "./store";

type Props = { cards: Card[]; welcome?: boolean; onLookup: (l: Lookup) => void };

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the bank's terms";
  }
};

export function Playbook({ cards, welcome, onLookup }: Props) {
  const spends = useMemo(() => bestBySpend(cards), [cards]);
  const shops = useMemo(() => bestByShop(cards, MERCHANTS), [cards]);
  const sheets = useMemo(() => cards.map((c) => ({ card: c, sheet: cardSheet(c, ALL_OFFERS, ALL_PROFILES.find((p) => p.id === c.id)) })), [cards]);

  useEffect(() => {
    track("playbook_viewed", { cards_held: cards.length, first_run: Boolean(welcome) });
    // Once per visit to the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (row: PlaybookRow, kind: "spend" | "shop") => {
    const spend = PLAYBOOK_SPENDS.find((s) => s.key === row.key);
    const m = MERCHANTS.find((x) => x.id === row.key);
    const lookup: Lookup | undefined =
      kind === "spend" && spend ? { ...spend.lookup, amount: 1000 } : m ? { merchant: m.id, category: m.category, channel: m.channel, rail: "card", amount: 1000 } : undefined;
    if (!lookup) return;
    track("playbook_row_tapped", { kind, key: row.key, card: row.cardId });
    onLookup(lookup);
  };

  const Row = ({ row, kind }: { row: PlaybookRow; kind: "spend" | "shop" }) => (
    <li>
      <button type="button" className="pb-row" onClick={() => open(row, kind)} aria-label={`${row.label}: ${row.cardName ?? "no card earns"}. See the full comparison`}>
        <span className="pb-what">{row.label}</span>
        <span className="pb-card">{row.cardName ?? "No card earns here"}</span>
        <span className={`pb-pct${row.pct ? "" : " none"}`}>{row.pct ? `${row.pct}%` : "0%"}</span>
      </button>
    </li>
  );

  return (
    <section className="playbook" aria-label="Your playbook">
      {welcome && <p className="pb-welcome">You&apos;re set. Here&apos;s which card to use where. Tap any row to compare all your cards, or use Pay to check a specific payment.</p>}
      <h3 className="section-title">Best card for…</h3>
      <ul className="pb-list">
        {spends.map((r) => (
          <Row key={r.key} row={r} kind="spend" />
        ))}
      </ul>
      {shops.length > 0 && (
        <>
          <h3 className="section-title">At specific shops</h3>
          <ul className="pb-list">
            {shops.map((r) => (
              <Row key={r.key} row={r} kind="shop" />
            ))}
          </ul>
        </>
      )}
      <p className="fine">Rates for a ₹1,000 payment before any monthly limit is used. Tap a row for the full answer.</p>

      <h3 className="section-title">Get the most from each card</h3>
      {sheets.map(({ card, sheet }) => (
        <details key={card.id} className="pb-card-sheet" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && track("playbook_card_opened", { card: card.id, tips: sheet.tips.length })}>
          <summary>
            <span>{card.name}</span>
            <small className="muted">{sheet.bestFor[0] ? `up to ${sheet.bestFor[0].pct}%` : `${sheet.basePct}% everywhere`}</small>
          </summary>
          {sheet.bestFor.length > 0 && (
            <>
              <p className="pb-head">Use it for</p>
              <ul className="pb-points">
                {sheet.bestFor.map((b) => (
                  <li key={b.label}>
                    {b.label}
                    {!b.label.includes(`${b.pct}%`) && ` (about ${b.pct}%)`}
                    {b.detail && <small className="muted"> · {b.detail}</small>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="pb-head">Everything else</p>
          <ul className="pb-points">
            <li>About {sheet.basePct}% back.</li>
            {sheet.earnsNothing.length > 0 && <li>Earns nothing on: {sheet.earnsNothing.join(", ")}.</li>}
          </ul>
          {sheet.watch.length > 0 && (
            <>
              <p className="pb-head">Watch out</p>
              <ul className="pb-points">
                {sheet.watch.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </>
          )}
          {sheet.tips.length > 0 && (
            <>
              <p className="pb-head">Tips</p>
              <ul className="pb-points">
                {sheet.tips.map((t) => (
                  <li key={t.text}>
                    {t.text}{" "}
                    {/^https?:\/\//.test(t.source) && (
                      <a href={t.source} target="_blank" rel="noopener noreferrer" className="linkish small">
                        Source: {host(t.source)}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {sheet.perks.length > 0 && (
            <>
              <p className="pb-head">Perks</p>
              <ul className="pb-points">
                {sheet.perks.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </details>
      ))}
    </section>
  );
}
