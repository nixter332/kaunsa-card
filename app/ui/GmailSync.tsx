"use client";
// "Log payments automatically from Gmail", on the Pay screen. Emails are read on this phone (see gmail.ts and
// lib/alerts.ts); only counts go to analytics. One tap per visit: Google needs a tap before it hands out access.
import { useEffect, useState } from "react";
import type { Unmatched } from "@/lib/importAlerts";
import type { Card } from "@/lib/types";
import { prepareGmail } from "./gmail";
import { inr } from "./store";

type Props = {
  clientId: string;
  connected: boolean;
  lastSync?: number;
  syncing: boolean;
  status?: string;
  unmatched: Unmatched[];
  cards: Card[];
  onSync: () => void;
  onLinkCard: (u: Unmatched, cardId: string) => void;
  onIgnore: (u: Unmatched) => void;
  /** Imported payments at shops the app doesn't know, valued at the base rate until the person names them. */
  toName: number;
  onOpenSavings: () => void;
};

function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

const normIssuer = (s: string) => s.toLowerCase().replace(/\b(bank|card|cards|credit)\b/g, "").replace(/[^a-z0-9]/g, "");

export function GmailSync({ clientId, connected, lastSync, syncing, status, unmatched, cards, onSync, onLinkCard, onIgnore, toName, onOpenSavings }: Props) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Load Google's script now, so the tap opens its popup at once (browsers block popups opened later).
    prepareGmail(clientId).then(() => setReady(true)).catch(() => setReady(false));
  }, [clientId]);

  // One question per unknown card (by issuer + last 4), not per payment.
  const asks = unmatched.filter((u, i) => unmatched.findIndex((x) => x.issuer === u.issuer && x.last4 === u.last4) === i);
  const stale = !lastSync || Date.now() - lastSync > 3 * 3600_000;

  return (
    <section className="gmail" aria-label="Payments from Gmail">
      {!connected ? (
        <>
          <p className="gmail-title">Log your card payments automatically</p>
          <p className="small muted">
            Connect Gmail and your card alert emails become logged payments: limits, cashback earned and anything missed fill in on their own. Emails are read on
            this phone and never reach our server.
          </p>
          <button type="button" className="btn primary small" disabled={!ready || syncing} onClick={onSync}>
            {syncing ? "Reading your card alerts…" : "Connect Gmail"}
          </button>
          <p className="fine">Works with HDFC, Axis, HSBC, IndusInd and Scapia alerts today. Google will show a warning that the app isn&apos;t verified yet.</p>
        </>
      ) : (
        <div className="gmail-row">
          <span className="small">
            <strong>Gmail</strong>
            <span className="muted"> · {status ?? (lastSync ? `synced ${ago(lastSync)}` : "not synced yet")}</span>
          </span>
          <button type="button" className={`btn small ${stale ? "primary" : "ghost"}`} disabled={!ready || syncing} onClick={onSync}>
            {syncing ? "Syncing…" : stale ? "Sync new payments" : "Sync"}
          </button>
        </div>
      )}

      {connected && toName > 0 && (
        <button type="button" className="linkish small gmail-name" onClick={onOpenSavings}>
          {toName} payment{toName === 1 ? " is" : "s are"} at shops we don&apos;t know, so {toName === 1 ? "it's" : "they're"} counted at your card&apos;s base rate. Tell us what they
          were →
        </button>
      )}

      {asks.map((u) => {
        const options = cards.filter((c) => normIssuer(c.issuer) === normIssuer(u.issuer));
        const count = unmatched.filter((x) => x.issuer === u.issuer && x.last4 === u.last4).length;
        return (
          <div key={`${u.issuer}|${u.last4}`} className="gmail-ask">
            <p className="small">
              Which card is <strong>{u.issuer}{u.last4 ? ` ••${u.last4}` : ""}</strong>? {count} payment{count === 1 ? "" : "s"}, e.g. {inr(u.amount)} at {u.label}.
            </p>
            <div className="chips">
              {(options.length ? options : cards).map((c) => (
                <button type="button" key={c.id} className="chip" onClick={() => onLinkCard(u, c.id)}>
                  {c.name}
                </button>
              ))}
              <button type="button" className="chip" onClick={() => onIgnore(u)}>
                Not in my cards
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
