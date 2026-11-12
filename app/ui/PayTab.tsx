"use client";
import { useEffect, useMemo, useState } from "react";
import { instantRead, MERCHANTS, suggestMerchants } from "@/lib/localParse";
import type { Card, Lookup, Offer } from "@/lib/types";
import { IconArrowUp, IconBack, IconClose, IconDelete, IconTag, TileIcon } from "./Icons";
import { inr, offerDeal, offerEnd, pretty, TILES, track, type Tile } from "./store";

/** The best card for a lookup, worked out on the device. */
export type Preview = { cardId: string; cardName: string; pct: number; totalInr: number; hasOffer: boolean };

/** A monthly or quarterly bonus limit that's partly used, for the "On your cards" block. */
export type CapRoom = { key: string; cardName: string; leftInr: number; period: string; label: string };

const EXAMPLES = ["dinner 2400", "zomato 650", "myntra 3000", "instamart 900", "electricity bill via gpay 1800", "kirana 800 via UPI"];

type Props = {
  onLookup: (l: Lookup, source: string) => void;
  onText: (text: string) => Promise<void>;
  busy: boolean;
  error: string;
  recent: string[];
  hasResult: boolean;
  onBack: () => void;
  /** A typed lookup that had no amount: ask for it. */
  pending: Lookup | null;
  onPendingDone: (l: Lookup) => void;
  onPendingCancel: () => void;
  children?: React.ReactNode; // the result, when there is one
  /** Live offers on the user's cards (bank offers first) and caps filling up. */
  offers: { offer: Offer; cards: Card[] }[];
  caps: CapRoom[];
  /** Best of the user's cards for a lookup, for the live preview and the tiles. */
  preview: (l: Lookup) => Preview | undefined;
  /** A one-line note for the start of a month (limits have reset). */
  monthNote?: string;
};

/** Days until an offer's last day (India time), for "ends in 3 days". */
function daysLeft(validTo?: string): number | undefined {
  if (!validTo) return undefined;
  const end = new Date(`${validTo}T23:59:59+05:30`).getTime();
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

export function PayTab({ onLookup, onText, busy, error, recent, hasResult, onBack, pending, onPendingDone, onPendingCancel, children, offers, caps, preview, monthNote }: Props) {
  const [text, setText] = useState("");
  const [tile, setTile] = useState<Tile | null>(null);
  const [example, setExample] = useState(0);
  // Live read of what's typed (no AI): a shop, maybe an amount, or shops to suggest.
  const live = useMemo(() => {
    const t = text.trim();
    if (t.length < 2) return null;
    const read = instantRead(t);
    if (read.lookup) return { kind: "answer" as const, name: read.merchant!.name, amount: read.lookup.amount, best: preview(read.lookup) };
    if (read.merchant) {
      const m = read.merchant;
      return { kind: "shop" as const, name: m.name, best: preview({ merchant: m.id, category: m.category, channel: m.channel, rail: "card", amount: 1000 }) };
    }
    const suggestions = suggestMerchants(t);
    return suggestions.length ? { kind: "suggest" as const, suggestions } : null;
  }, [text, preview]);
  // Each category tile shows the best card for it, so the common answers need no typing at all.
  const tileBest = useMemo(
    () => Object.fromEntries(TILES.map((t) => [t.id, preview({ category: t.category, channel: t.channel, rail: t.rail, amount: 1000 })])),
    [preview],
  );
  const shownOffers = offers.slice(0, 2);
  const shownCaps = caps.slice(0, 1);
  useEffect(() => {
    if (shownOffers.length || shownCaps.length) track("home_cards_shown", { offers: offers.length, caps: caps.length });
    // Once per visit to the Pay screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 3200);
    return () => clearInterval(t);
  }, []);

  if (hasResult) {
    return (
      <div className="screen">
        <button type="button" className="back" onClick={onBack}>
          <IconBack size={20} /> New payment
        </button>
        {children}
      </div>
    );
  }

  return (
    <div className="screen">
      <h1 className="hero">What are you paying for?</h1>
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onText(text.trim());
        }}
      >
        <input
          className="ask-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Try “${EXAMPLES[example]}”`}
          aria-label="Describe the payment, with the amount"
          enterKeyHint="go"
        />
        <button className="ask-go" aria-label="Look it up" disabled={busy || !text.trim()}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <IconArrowUp />}
        </button>
      </form>
      {live?.kind === "answer" && (
        <button
          type="button"
          className="live"
          onClick={() => {
            track("instant_preview_tapped", { kind: "answer" });
            onText(text.trim());
          }}
        >
          <span className="live-what">
            {live.name} {inr(live.amount)}
          </span>
          {live.best ? (
            <span className="live-best">
              {live.best.cardName} · <strong>{inr(live.best.totalInr)} {live.best.hasOffer ? "saved" : "back"}</strong>
            </span>
          ) : (
            <span className="live-best muted">None of your cards earns here</span>
          )}
          <span className="live-more">See why and compare</span>
        </button>
      )}
      {live?.kind === "shop" && (
        <p className="live static" aria-live="polite">
          <span className="live-what">{live.name}</span>
          {live.best ? (
            <span className="live-best">
              {live.best.cardName} · <strong>{live.best.pct}%</strong>
            </span>
          ) : (
            <span className="live-best muted">None of your cards earns here</span>
          )}
          <span className="live-more">Add the amount for the exact ₹ and your limits</span>
        </p>
      )}
      {live?.kind === "suggest" && (
        <div className="chips live-suggest" role="group" aria-label="Did you mean">
          {live.suggestions.map((m) => (
            <button
              type="button"
              key={m.id}
              className="chip"
              onClick={() => {
                track("suggestion_tapped", { merchant: m.id });
                const amount = text.match(/\d[\d,.]*k?/i)?.[0];
                setText(`${m.name} ${amount ?? ""}`.trimEnd() + (amount ? "" : " "));
              }}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {!hasResult && (shownOffers.length > 0 || shownCaps.length > 0 || monthNote) && (
        <section className="home-cards" aria-label="On your cards">
          {monthNote && <p className="home-cap">{monthNote}</p>}
          {shownCaps.map((c) => (
            <p key={c.key} className="home-cap">
              <strong>{c.cardName}</strong>: {c.leftInr > 0 ? `${inr(c.leftInr)} of bonus left this ${c.period}` : `bonus used up this ${c.period}`}
              <small className="muted"> · {c.label}</small>
            </p>
          ))}
          {shownOffers.map(({ offer, cards }) => {
            const m = MERCHANTS.find((x) => x.id === offer.merchants[0]);
            if (!m) return null;
            const end = offer.kind === "bank_offer" ? offerEnd(offer) : "";
            const left = offer.kind === "bank_offer" ? daysLeft(offer.validTo) : undefined;
            const ending = left !== undefined && left <= 7;
            return (
              <button
                type="button"
                key={offer.id}
                className="home-offer"
                onClick={() => {
                  track("home_offer_tapped", { offer_id: offer.id, kind: offer.kind, merchant: m.id });
                  setTile({ id: "offer", label: m.name, hint: "", category: m.category, channel: m.channel, rail: offer.rails?.[0] ?? "card", merchants: offer.merchants, preselect: m.id });
                }}
              >
                <span className="o-title">
                  <IconTag size={15} /> {m.name}: {offerDeal(offer)}
                  {offer.payment === "emi" ? " (no-cost EMI)" : ""}
                </span>
                <span className="o-meta">
                  {cards.map((c) => c.name).join(", ")}
                  {end && !ending && ` · till ${end}`}
                  {ending && <strong className="ending"> · {left === 0 ? "ends today" : left === 1 ? "ends tomorrow" : `ends in ${left} days`}</strong>}
                </span>
              </button>
            );
          })}
          {offers.length > shownOffers.length && <p className="muted small">More offers in My cards.</p>}
        </section>
      )}

      <p className="or">or tap a category</p>
      <div className="tiles">
        {TILES.map((t) => (
          <button type="button" key={t.id} className="cat" onClick={() => setTile(t)}>
            <TileIcon id={t.id} />
            <span className="cat-label">{t.label}</span>
            {tileBest[t.id] ? (
              <span className="cat-hint cat-best">
                {tileBest[t.id]!.cardName} · {tileBest[t.id]!.pct}%
              </span>
            ) : (
              <span className="cat-hint">{t.hint}</span>
            )}
          </button>
        ))}
      </div>

      {recent.length > 0 && (
        <section className="recent">
          <h3 className="section-title">Recent</h3>
          <div className="chips">
            {recent.map((r) => (
              <button type="button" key={r} className="chip" onClick={() => onText(r)}>
                {r}
              </button>
            ))}
          </div>
        </section>
      )}

      {pending && !tile && (
        <AmountSheet
          tile={pendingTile(pending)}
          initial={pending}
          title="How much is it?"
          onClose={onPendingCancel}
          onDone={onPendingDone}
        />
      )}
      {tile && <AmountSheet tile={tile} onClose={() => setTile(null)} onDone={(l) => (setTile(null), onLookup(l, `tile:${tile.id}`))} />}
    </div>
  );
}

function pendingTile(l: Lookup): Tile {
  const m = MERCHANTS.find((x) => x.id === l.merchant);
  return { id: "typed", label: m?.name ?? pretty(l.category), hint: "", category: l.category, channel: l.channel, rail: l.rail, merchants: [] };
}

type SheetProps = { tile: Tile; initial?: Lookup; title?: string; onClose: () => void; onDone: (l: Lookup) => void };

function AmountSheet({ tile, initial, title, onClose, onDone }: SheetProps) {
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState<string | undefined>(initial?.merchant ?? tile.preselect);
  const [rail, setRail] = useState<Lookup["rail"]>(initial?.rail ?? tile.rail);
  const m = MERCHANTS.find((x) => x.id === merchant);

  const press = (k: string) => {
    if (k === "del") return setAmount((a) => a.slice(0, -1));
    setAmount((a) => (a + k).replace(/^0+/, "").slice(0, 7));
  };
  const value = Number(amount || 0);

  function done() {
    if (!value) return;
    const channel = rail === "upi" ? "offline" : initial?.channel ?? m?.channel ?? tile.channel;
    onDone({ merchant, category: m?.category ?? tile.category, amount: value, channel, rail });
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title ?? tile.label} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title ?? tile.label}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        {title && <p className="muted small">{tile.label}: add the amount to compare your cards.</p>}
        {tile.merchants.length > 0 && (
          <div className="chips" role="group" aria-label="Where (optional)">
            {tile.merchants.map((id) => {
              const mm = MERCHANTS.find((x) => x.id === id);
              if (!mm) return null;
              return (
                <button type="button" key={id} className={`chip${merchant === id ? " on" : ""}`} aria-pressed={merchant === id} onClick={() => setMerchant(merchant === id ? undefined : id)}>
                  {mm.name}
                </button>
              );
            })}
          </div>
        )}
        <div className="amount" aria-live="polite">
          <span className="amount-sym">₹</span>
          <span className={`amount-num${amount ? "" : " empty"}`}>{amount ? Number(amount).toLocaleString("en-IN") : "0"}</span>
        </div>
        <div className="seg" role="group" aria-label="How you'll pay">
          <button type="button" className={rail === "card" ? "on" : ""} onClick={() => setRail("card")}>
            Card
          </button>
          <button type="button" className={rail === "upi" ? "on" : ""} onClick={() => setRail("upi")}>
            UPI
          </button>
        </div>
        <div className="keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"].map((k) => (
            <button type="button" key={k} className="key" onClick={() => press(k)} aria-label={k === "del" ? "Delete" : k}>
              {k === "del" ? <IconDelete /> : k}
            </button>
          ))}
        </div>
        <button type="button" className="btn primary wide" disabled={!value} onClick={done}>
          Find the best card
        </button>
      </div>
    </div>
  );
}
