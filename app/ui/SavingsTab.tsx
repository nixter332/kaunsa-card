"use client";
import { useState } from "react";
import { needsKind, shopOf, SHOP_KINDS, type ShopKindId } from "@/lib/importAlerts";
import { cardById, inr, type LedgerEntry } from "./store";

/**
 * Gmail alerts name the shop the way the bank's terminal does ("JIMIS BURGER LLP") with no category, so those payments
 * count at the card's base rate. One question per shop, biggest spend first; the answer is remembered on this phone.
 */
function ShopQuestion({ ledger, onNameShop }: { ledger: LedgerEntry[]; onNameShop: (shop: string, kind: ShopKindId) => void }) {
  const groups = new Map<string, { label: string; count: number; total: number; cardId: string }>();
  for (const e of ledger.filter(needsKind)) {
    const shop = shopOf(e)!;
    const g = groups.get(shop) ?? { label: e.label ?? shop, count: 0, total: 0, cardId: e.cardId };
    g.count++;
    g.total += e.amount;
    groups.set(shop, g);
  }
  const list = [...groups.entries()].sort((a, b) => b[1].total - a[1].total);
  if (!list.length) return null;
  const [shop, g] = list[0];
  return (
    <section className="gmail shop-ask" aria-label="What was this payment?">
      <p className="small">
        <strong>What is {g.label}?</strong> {g.count === 1 ? "1 payment" : `${g.count} payments`}, {inr(g.total)} on {cardById(g.cardId)?.name ?? "your card"}. Counted at
        the base rate until you say.
      </p>
      <div className="chips">
        {SHOP_KINDS.map((k) => (
          <button type="button" key={k.id} className="chip" onClick={() => onNameShop(shop, k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      <p className="fine">
        {list.length > 1 ? `${list.length - 1} more shop${list.length === 2 ? "" : "s"} after this. ` : ""}Remembered on this phone, so you&apos;re asked once per shop.
      </p>
    </section>
  );
}

export function SavingsTab({
  ledger,
  onRemove,
  onNameShop,
}: {
  ledger: LedgerEntry[];
  onRemove: (ts: number) => void;
  onNameShop: (shop: string, kind: ShopKindId) => void;
}) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const now = new Date();
  const month = ledger.filter((e) => {
    const d = new Date(e.ts);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const earned = month.reduce((s, e) => s + (e.earned ?? 0), 0);
  const missed = month.reduce((s, e) => s + Math.max(0, (e.best ?? 0) - (e.earned ?? 0)), 0);
  const spent = month.reduce((s, e) => s + e.amount, 0);
  const rightCard = month.filter((e) => e.best === undefined || (e.earned ?? 0) >= (e.best ?? 0)).length;
  const monthName = now.toLocaleString("en-IN", { month: "long" });

  if (month.length === 0) {
    return (
      <div className="screen">
        <h1 className="title">Savings</h1>
        <ShopQuestion ledger={ledger} onNameShop={onNameShop} />
        <div className="empty">
          <p className="empty-big">Nothing logged in {monthName} yet.</p>
          <p className="muted">After a lookup, tap “I paid with this card”. Your rewards, bank discounts, and anything you missed by using a different card add up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1 className="title">Savings</h1>
      <section className="earned">
        <p className="earned-label">Saved in {monthName}</p>
        <p className="earned-amount">{inr(earned)}</p>
        <p className="muted small">
          on {inr(spent)} of spending, {month.length} {month.length === 1 ? "payment" : "payments"}
        </p>
      </section>
      <div className="stats">
        <div className="stat">
          <span className="stat-num">{inr(missed)}</span>
          <span className="stat-label">missed by using another card</span>
        </div>
        <div className="stat">
          <span className="stat-num">
            {rightCard}/{month.length}
          </span>
          <span className="stat-label">payments on the best card</span>
        </div>
      </div>

      <ShopQuestion ledger={ledger} onNameShop={onNameShop} />

      <h3 className="section-title">This month</h3>
      <ul className="ledger">
        {[...month].reverse().map((e) => {
          const card = cardById(e.cardId);
          const miss = Math.max(0, (e.best ?? 0) - (e.earned ?? 0));
          return (
            <li key={e.ts}>
              <div>
                <strong>
                  {e.label ?? "Payment"}
                  {e.source === "gmail" && <span className="from-gmail"> · from Gmail</span>}
                </strong>
                <small className="muted">
                  {new Date(e.ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, {card?.name ?? e.cardId}
                </small>
              </div>
              <div className="ledger-val">
                <span>{inr(e.amount)}</span>
                <small className="pos">+{inr(e.earned ?? 0)}</small>
                {miss > 0 && <small className="neg">missed {inr(miss)}</small>}
                {confirming === e.ts ? (
                  <small>
                    Remove?{" "}
                    <button type="button" className="linkish small" onClick={() => (setConfirming(null), onRemove(e.ts))}>
                      Yes
                    </button>{" "}
                    <button type="button" className="linkish small" onClick={() => setConfirming(null)}>
                      No
                    </button>
                  </small>
                ) : (
                  <button type="button" className="linkish small" aria-label={`Remove ${e.label ?? "payment"}, ${inr(e.amount)}`} onClick={() => setConfirming(e.ts)}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
