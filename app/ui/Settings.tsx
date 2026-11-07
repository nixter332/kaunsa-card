"use client";
import { useState } from "react";
import { analyticsEnabled, setStatsEnabled, statsEnabled } from "@/lib/analytics";
import type { AppUser } from "./App";
import { IconClose, IconLogout } from "./Icons";

export type ThemeChoice = "system" | "dark" | "light";

type Props = {
  user: AppUser;
  onSignOut: () => void;
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  canInstall: boolean;
  onInstall: () => void;
  onReplay: () => void;
  onClear: () => void;
  onClose: () => void;
};

export function Settings({ user, onSignOut, theme, onTheme, canInstall, onInstall, onReplay, onClear, onClose }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
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

        <div className="setting account">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>
          )}
          <div>
            <strong>{user.name || "Signed in"}</strong>
            <small className="muted">{user.email}</small>
          </div>
          <button
            type="button"
            className="btn ghost small"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              onSignOut();
            }}
          >
            <IconLogout size={18} /> Sign out
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
                <strong>Share usage stats</strong>
                <small className="muted">Which cards you add, what you look up (like “zomato 650”), and reports you send, linked to your Google name and email. Never card numbers or bank details.</small>
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
