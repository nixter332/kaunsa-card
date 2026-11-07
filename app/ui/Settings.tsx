"use client";
import { useState } from "react";
import { analyticsEnabled, setStatsEnabled, statsEnabled } from "@/lib/analytics";
import { IconClose } from "./Icons";

export type ThemeChoice = "system" | "dark" | "light";

type Props = {
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  canInstall: boolean;
  onInstall: () => void;
  onReplay: () => void;
  onClear: () => void;
  onClose: () => void;
};

export function Settings({ theme, onTheme, canInstall, onInstall, onReplay, onClear, onClose }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [stats, setStats] = useState(statsEnabled);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        <div className="setting">
          <span>Appearance</span>
          <div className="seg" role="group" aria-label="Appearance">
            {(["system", "dark", "light"] as const).map((t) => (
              <button type="button" key={t} className={theme === t ? "on" : ""} onClick={() => onTheme(t)}>
                {t === "system" ? "Auto" : t === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <span>Use it like an app</span>
          {canInstall ? (
            <button type="button" className="btn ghost wide" onClick={onInstall}>
              Add to home screen
            </button>
          ) : (
            <p className="fine">On Android, open your browser menu and tap Add to Home Screen or Install app. On iPhone, tap Share, then Add to Home Screen.</p>
          )}
        </div>

        {analyticsEnabled && (
          <div className="setting">
            <label className="toggle-row">
              <span>
                <strong>Share anonymous usage stats</strong>
                <small className="muted">Which cards people add, what they look up, and wrong-answer reports. No names, numbers or bank details.</small>
              </span>
              <input
                type="checkbox"
                checked={stats}
                onChange={(e) => {
                  setStats(e.target.checked);
                  setStatsEnabled(e.target.checked);
                }}
              />
            </label>
          </div>
        )}

        <div className="setting">
          <button type="button" className="btn ghost wide" onClick={onReplay}>
            Show the walkthrough again
          </button>
          <button
            type="button"
            className={`btn wide ${confirming ? "danger" : "ghost"}`}
            onClick={() => (confirming ? onClear() : setConfirming(true))}
          >
            {confirming ? "Tap again to clear cards and payments" : "Clear my cards and payments"}
          </button>
        </div>

        <p className="fine">
          Rewards are estimates based on each bank&apos;s published terms, read and checked when the card was added. Your cards and payments are stored on this device. Not financial advice.
        </p>
      </div>
    </div>
  );
}
