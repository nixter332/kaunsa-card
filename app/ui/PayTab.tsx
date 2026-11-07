"use client";
import { useEffect, useState } from "react";
import { MERCHANTS } from "@/lib/localParse";
import type { Lookup } from "@/lib/types";
import { IconArrowUp, IconBack, IconClose, IconDelete, TileIcon } from "./Icons";
import { pretty, TILES, type Tile } from "./store";

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
};

export function PayTab({ onLookup, onText, busy, error, recent, hasResult, onBack, pending, onPendingDone, onPendingCancel, children }: Props) {
  const [text, setText] = useState("");
  const [tile, setTile] = useState<Tile | null>(null);
  const [example, setExample] = useState(0);

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
      {error && <p className="error">{error}</p>}

      <p className="or">or tap a category</p>
      <div className="tiles">
        {TILES.map((t) => (
          <button type="button" key={t.id} className="cat" onClick={() => setTile(t)}>
            <TileIcon id={t.id} />
            <span className="cat-label">{t.label}</span>
            <span className="cat-hint">{t.hint}</span>
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
  const [merchant, setMerchant] = useState<string | undefined>(initial?.merchant);
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
