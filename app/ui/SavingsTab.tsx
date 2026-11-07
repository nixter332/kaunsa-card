"use client";
import { cardById, inr, type LedgerEntry } from "./store";

export function SavingsTab({ ledger }: { ledger: LedgerEntry[] }) {
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
        <div className="empty">
          <p className="empty-big">Nothing logged in {monthName} yet.</p>
          <p className="muted">After a lookup, tap “I paid with this card”. Your rewards and anything you missed by using a different card add up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1 className="title">Savings</h1>
      <section className="earned">
        <p className="earned-label">Earned in {monthName}</p>
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

      <h3 className="section-title">This month</h3>
      <ul className="ledger">
        {[...month].reverse().map((e) => {
          const card = cardById(e.cardId);
          const miss = Math.max(0, (e.best ?? 0) - (e.earned ?? 0));
          return (
            <li key={e.ts}>
              <div>
                <strong>{e.label ?? "Payment"}</strong>
                <small className="muted">
                  {new Date(e.ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, {card?.name ?? e.cardId}
                </small>
              </div>
              <div className="ledger-val">
                <span>{inr(e.amount)}</span>
                <small className="pos">+{inr(e.earned ?? 0)}</small>
                {miss > 0 && <small className="neg">missed {inr(miss)}</small>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
