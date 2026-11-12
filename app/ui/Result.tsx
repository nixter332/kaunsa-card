"use client";
import { MERCHANTS } from "@/lib/localParse";
import type { MerchantHint } from "@/lib/engine";
import { amountBucket } from "@/lib/analytics";
import { CATEGORIES, type AppliedOffer, type Lookup, type Recommendation } from "@/lib/types";
import { betterDeal } from "@/lib/offers";
import { earnsMoreAt } from "@/lib/playbook";
import { useEffect, useState } from "react";
import { CardTile } from "./CardTile";
import { shareLink } from "./referral";
import { SourcePanel } from "./SourcePanel";
import { IconTag } from "./Icons";
import { cardById, inr, niceDate, pointValueLine, pretty, track } from "./store";

type Props = {
  lookup: Lookup;
  setLookup: (l: Lookup) => void;
  results: Recommendation[];
  hints: MerchantHint[];
  parser: string;
  note?: string;
  paidWith: string | null;
  onPaid: (r: Recommendation) => void;
  onToast: (msg: string) => void;
};

export function Result({ lookup, setLookup, results, hints, parser, note, paidWith, onPaid, onToast }: Props) {
  const [editing, setEditing] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  // A different shop or spend type is a new answer: ask again.
  useEffect(() => {
    setVote(null);
    setFlagged(false);
    setReportOpen(false);
  }, [lookup.merchant, lookup.category, lookup.amount, lookup.rail, lookup.channel]);
  // What the answer was when the edit panel opened, to report what people correct.
  const [before, setBefore] = useState<Lookup | null>(null);
  function toggleEdit() {
    if (!editing) {
      setBefore(lookup);
      setEditing(true);
      return;
    }
    setEditing(false);
    if (!before) return;
    const fields = (["merchant", "category", "amount", "channel", "rail"] as const).filter((k) => before[k] !== lookup[k]);
    if (fields.length)
      track("lookup_edited", {
        fields,
        parser: parser || "tile",
        from_merchant: before.merchant,
        to_merchant: lookup.merchant,
        from_category: before.category,
        to_category: lookup.category,
        from_rail: before.rail,
        to_rail: lookup.rail,
        amount_changed: before.amount !== lookup.amount,
        amount_range: amountBucket(lookup.amount),
        best_card: best?.cardId,
      });
  }
  const best = results.find((r) => r.usable);
  const rest = results.filter((r) => r !== best);
  const top = Math.max(best?.totalInr ?? 0, 1);
  const merchant = MERCHANTS.find((m) => m.id === lookup.merchant);
  const bestCard = best && cardById(best.cardId);
  const runnerUp = rest.find((r) => r.usable);
  const gap = best && runnerUp ? best.totalInr - runnerUp.totalInr : 0;
  const deal = betterDeal(results);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setCopied(false);
    if (deal)
      track("offer_tip_shown", { offer_id: deal.tip.offerId, card: deal.rec.cardId, discount_inr: deal.tip.discountInr, extra_inr: Math.round(deal.extra) });
    // Once per answer, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup.merchant, lookup.amount, deal?.tip.offerId, deal?.rec.cardId]);
  const otherTips = results
    .filter((r) => r.usable)
    .flatMap((r) =>
      (r.offerTips ?? [])
        .filter((t) => !(deal && deal.rec === r && deal.tip.offerId === t.offerId))
        .map((t) => (r === best ? t.text : `${r.cardName}: ${t.short}.`)),
    );
  /** Send this answer to a friend (WhatsApp etc.), with this person's share code in the link. */
  async function share() {
    if (!best) return;
    const where = merchant?.name ?? pretty(lookup.category);
    const gain = best.offer ? `saves ${inr(best.totalInr)}` : `gives ${inr(best.totalInr)} back`;
    const text = `${where} ${inr(lookup.amount)}: ${best.cardName} ${gain}. Kaunsa Card tells you which of your cards to use for every payment.`;
    const url = shareLink();
    const props = { best_card: best.cardId, merchant: lookup.merchant, category: lookup.category, amount_range: amountBucket(lookup.amount) };
    track("share_clicked", props);
    if (navigator.share) {
      try {
        await navigator.share({ text, url });
        track("answer_shared", { ...props, method: "native" });
      } catch {
        track("answer_share_cancelled", props);
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      onToast("Copied. Paste it in WhatsApp.");
      track("answer_shared", { ...props, method: "copy" });
    } catch {
      onToast("Couldn't copy. Try again.");
    }
  }
  const [missedOpen, setMissedOpen] = useState(false);
  const [missedSent, setMissedSent] = useState(false);
  const [missedCard, setMissedCard] = useState("");
  const [missedAmount, setMissedAmount] = useState("");
  const [missedText, setMissedText] = useState("");

  return (
    <div className="result">
      <button type="button" className="summary" onClick={toggleEdit} aria-expanded={editing}>
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

      {hints.length > 0 && (
        <section className="hint" aria-label="Where are you paying?">
          <p className="hint-title">Paying on one of these? Your cards earn more there.</p>
          <div className="chips">
            {hints.map((h) => {
              const m = MERCHANTS.find((x) => x.id === h.merchantId);
              if (!m) return null;
              return (
                <button
                  type="button"
                  key={h.merchantId}
                  className="chip"
                  onClick={() => {
                    track("merchant_hint_used", { merchant: h.merchantId, category: lookup.category, card: h.cardId });
                    setLookup({ ...lookup, merchant: m.id, category: m.category, channel: lookup.rail === "upi" ? lookup.channel : m.channel });
                  }}
                >
                  {m.name} · {inr(h.valueInr)}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {best && deal && (
        <section className="better-deal" aria-live="polite">
          <p className="bd-label">
            <IconTag size={15} /> Better deal on EMI
          </p>
          <p className="bd-main">
            {inr(deal.tip.discountInr)} off with {deal.rec.cardName}
          </p>
          <p className="bd-how">
            Pay by no-cost EMI{deal.tip.code ? " and use code " : "."}
            {deal.tip.code && <strong>{deal.tip.code}</strong>}
            {deal.tip.code && "."} That&apos;s {inr(deal.extra)} more than paying in full with {best.cardName}.
          </p>
          {deal.tip.conditions && <p className="bd-small">{deal.tip.conditions}</p>}
          {deal.tip.code && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                navigator.clipboard?.writeText(deal.tip.code!).catch(() => {});
                setCopied(true);
                track("offer_tip_code_copied", { offer_id: deal.tip.offerId, card: deal.rec.cardId });
              }}
            >
              {copied ? "Code copied" : `Copy ${deal.tip.code}`}
            </button>
          )}
        </section>
      )}

      {best && bestCard ? (
        <section className="winner" aria-live="polite">
          <CardTile card={bestCard} size="lg">
            <div className="tile-value">
              <span className="tile-amount">{inr(best.totalInr)}</span>
              <span className="tile-pct">{best.offer ? "saved" : `back, ${best.effectivePct}%`}</span>
            </div>
          </CardTile>
          {best.offer ? (
            <OfferBox offer={best.offer} reward={best.valueInr} paid={lookup.amount - best.offer.discountInr} reason={best.reason} />
          ) : (
            <p className="why">{best.reason}</p>
          )}
          {pointValueLine(bestCard) && <p className="muted small">{pointValueLine(bestCard)}</p>}
          {best.ruleLabel === "Base rate" && earnsMoreAt(bestCard).length > 0 && (
            <p className="muted small">
              This is {bestCard.name}&apos;s everyday rate. It earns more on: {earnsMoreAt(bestCard).join("; ")}.
            </p>
          )}
          {otherTips.map((h) => (
            <p key={h} className="offer-hint">
              <IconTag size={15} /> {h}
            </p>
          ))}
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
            <button type="button" className="btn ghost small" onClick={share}>
              Share this answer
            </button>
          </div>
          <div className="vote" role="group" aria-label="Was this answer right?">
            <span>{vote === "up"
                ? "Thanks!"
                : flagged
                  ? "Reported. Thanks, this gets checked against the bank's terms."
                  : vote === "down"
                    ? "What was wrong? Tell us below."
                    : "Was this right?"}</span>
            {!vote && (
              <>
                <button
                  type="button"
                  className="vote-btn"
                  aria-label="Yes, this was right"
                  onClick={() => {
                    setVote("up");
                    track("answer_vote", { vote: "up", merchant: lookup.merchant, category: lookup.category, best_card: best.cardId, parser });
                  }}
                >
                  👍
                </button>
                <button
                  type="button"
                  className="vote-btn"
                  aria-label="No, this was wrong"
                  onClick={() => {
                    setVote("down");
                    setReportOpen(true);
                    track("answer_vote", { vote: "down", merchant: lookup.merchant, category: lookup.category, best_card: best.cardId, parser });
                  }}
                >
                  👎
                </button>
              </>
            )}
          </div>
          <SourcePanel key={`${best.cardId}|${best.ruleLabel}`} card={bestCard} rec={best} />
          <p className="fine">
            {best.lastVerified === "never" ? "Rules for this card are from review sites, not yet checked against the bank's terms." : `Rules checked ${niceDate(best.lastVerified)}.`}{" "}
            Bank offers are shown once we&apos;ve verified them.{" "}
            {missedSent ? (
              <span>Thanks, we&apos;ll look into that offer.</span>
            ) : (
              <button type="button" className="linkish" onClick={() => setMissedOpen(!missedOpen)} aria-expanded={missedOpen}>
                Got a discount we didn&apos;t show?
              </button>
            )}
          </p>
          {missedOpen && !missedSent && (
            <form
              className="report"
              onSubmit={(e) => {
                e.preventDefault();
                track("offer_missed", {
                  merchant: lookup.merchant,
                  category: lookup.category,
                  amount_range: amountBucket(lookup.amount),
                  card: missedCard || undefined,
                  discount_inr: Number(missedAmount) || undefined,
                  comment: missedText.trim().slice(0, 300) || undefined,
                });
                setMissedSent(true);
                setMissedOpen(false);
              }}
            >
              <label className="small" htmlFor="missed-card">
                Which card, and how much off?
              </label>
              <div className="report-row">
                <select id="missed-card" className="field" value={missedCard} onChange={(e) => setMissedCard(e.target.value)}>
                  <option value="">Card…</option>
                  {results.map((r) => (
                    <option key={r.cardId} value={r.cardId}>
                      {r.cardName}
                    </option>
                  ))}
                </select>
                <input
                  className="field"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  placeholder="₹ off"
                  aria-label="Discount in rupees"
                  value={missedAmount}
                  onChange={(e) => setMissedAmount(e.target.value)}
                />
              </div>
              <textarea
                className="field textarea"
                rows={2}
                maxLength={300}
                placeholder="Anything else, e.g. coupon code, EMI only, which day"
                value={missedText}
                onChange={(e) => setMissedText(e.target.value)}
              />
              <button className="btn ghost wide">Send</button>
            </form>
          )}
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
                What was wrong? A discount you got, a different rate… (optional)
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
                  <span className="compare-val">{r.usable ? inr(r.totalInr) : "Can't use"}</span>
                </div>
                {r.usable && (
                  <div className="bar" aria-hidden="true">
                    <div style={{ width: `${Math.max(2, (r.totalInr / top) * 100)}%` }} />
                  </div>
                )}
                <p className="compare-why">
                  {!r.usable
                    ? r.reason
                    : r.offer
                      ? `${inr(r.offer.discountInr)} off (${r.offer.title}) + ${inr(r.valueInr)} rewards.`
                      : r.reason.includes(`${r.effectivePct}%`)
                        ? r.reason
                        : `${r.effectivePct}%. ${r.reason}`}
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

function OfferBox({ offer, reward, paid, reason }: { offer: AppliedOffer; reward: number; paid: number; reason: string }) {
  const end = offer.validTo ? new Date(`${offer.validTo}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
  const details = [
    offer.code && `Code ${offer.code}`,
    offer.payment === "emi" && "No-cost EMI only",
    offer.conditions,
    end && `Till ${end}`,
  ].filter(Boolean);
  return (
    <div className="offer-box">
      <p className="offer-head">
        <IconTag /> {inr(offer.discountInr)} off: {offer.title}
        {offer.kind === "card_perk" && <span className="offer-kind">Card perk</span>}
      </p>
      {details.length > 0 && <p className="offer-details">{details.join(" · ")}</p>}
      <p className="offer-plus">
        Plus {inr(reward)} in rewards on the {inr(paid)} you pay. {reason}
      </p>
    </div>
  );
}
