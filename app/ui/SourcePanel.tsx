"use client";
// "Where's this from?": the bank's own words behind an answer, with the documents and how sure we are.
import { useState } from "react";
import { isWatchable } from "@/lib/sources";
import type { Card, Recommendation } from "@/lib/types";
import { pointValueLine, track } from "./store";

const CONFIDENCE: Record<Card["confidence"], string> = {
  high: "High: matched to the bank's own terms.",
  medium: "Medium: from the bank's terms, but some details aren't spelled out there.",
  low: "Low: partly from review sites, not yet checked against the bank's terms.",
};

function docLabel(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${/\.pdf($|\?)/i.test(u.pathname) ? " (PDF)" : ""}`;
  } catch {
    return url;
  }
}

export function SourcePanel({ card, rec }: { card: Card; rec: Recommendation }) {
  const [open, setOpen] = useState(false);
  const rule = card.rules.find((r) => r.label === rec.ruleLabel);
  const ev = rule?.evidence;
  const docs = card.sources.filter((s) => isWatchable(s.url)).slice(0, 3);
  const value = pointValueLine(card);
  const link = (url: string) => (
    <a href={url} target="_blank" rel="noopener noreferrer" className="linkish" onClick={() => track("source_link_clicked", { card: card.id, host: docLabel(url) })}>
      {docLabel(url)}
    </a>
  );

  return (
    <div className="source">
      <button
        type="button"
        className="linkish small"
        aria-expanded={open}
        onClick={() => {
          if (!open) track("source_opened", { card: card.id, rule: rule?.id ?? rec.ruleLabel, has_quote: Boolean(ev), confidence: card.confidence });
          setOpen(!open);
        }}
      >
        {open ? "Hide where this is from" : "Where's this from?"}
      </button>
      {open && (
        <div className="source-body">
          <p className="small">{rule ? <>This answer uses {card.name}&apos;s rule: <strong>{rule.label}</strong>.</> : <>This answer uses {card.name}&apos;s {rec.ruleLabel.toLowerCase()}.</>}</p>
          {ev ? (
            <>
              <blockquote>&ldquo;{ev.quote}&rdquo;</blockquote>
              <p className="muted small">
                The bank&apos;s own words, matched word for word on {ev.checked}
                {/^https?:\/\//.test(ev.source) ? <> in {link(ev.source)}</> : " in the bank's terms (a PDF we saved)"}.
              </p>
            </>
          ) : (
            rule && <p className="muted small">We haven&apos;t matched this rate to the bank&apos;s exact words yet. It comes from the documents below.</p>
          )}
          {value && <p className="muted small">{value}</p>}
          <p className="muted small">Confidence: {CONFIDENCE[card.confidence]}</p>
          {docs.length > 0 && (
            <p className="muted small">
              Bank documents:{" "}
              {docs.map((d, i) => (
                <span key={d.url}>
                  {i > 0 && ", "}
                  {link(d.url)}
                </span>
              ))}
            </p>
          )}
          <p className="muted small">{card.lastVerified === "never" ? "Not yet checked against the bank's terms." : `Rules last checked ${card.lastVerified}.`} Every rate comes from these documents; AI never sets one.</p>
        </div>
      )}
    </div>
  );
}
