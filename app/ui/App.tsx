"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { amountBucket, identifyUser, resetUser, setPersonOnce } from "@/lib/analytics";
import { signOutOfApp } from "../actions";
import { merchantHints, recommend, type OfferContext } from "@/lib/engine";
import { localParse, MERCHANTS } from "@/lib/localParse";
import type { Lookup, Recommendation } from "@/lib/types";
import { AdvisorTab } from "./AdvisorTab";
import { CardsTab } from "./CardsTab";
import { IconAdvisor, IconCards, IconPay, IconSavings, IconSettings } from "./Icons";
import { Onboarding } from "./Onboarding";
import { PayTab } from "./PayTab";
import { Result } from "./Result";
import { SavingsTab } from "./SavingsTab";
import { myShareCode } from "./referral";
import { Settings, type ThemeChoice } from "./Settings";
import { ALL_CARDS, ALL_OFFERS, load, offerUsesFromLedger, pretty, save, statesFromLedger, track, type LedgerEntry } from "./store";

type Tab = "pay" | "cards" | "savings" | "advisor";
type InstallPrompt = Event & { prompt: () => Promise<void> };

function applyTheme(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0d1311" : "#f3f6f4");
}

export type AppUser = { id: string; name: string; email: string; image?: string };

export function App({ user }: { user: AppUser }) {
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(true);
  const [tab, setTab] = useState<Tab>("pay");
  const [myCardIds, setMyCardIds] = useState<string[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [met, setMet] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);

  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [parser, setParser] = useState("");
  const [note, setNote] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paidWith, setPaidWith] = useState<string | null>(null);
  // The ledger entry logged for the answer on screen, so a second tap replaces it instead of adding another.
  const [paidTs, setPaidTs] = useState<number | null>(null);
  const [needAmount, setNeedAmount] = useState<{ lookup: Lookup; query: string; parser: string } | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    identifyUser(user);
    // Share code for links this person sends, and (once) whose link brought them here.
    setPersonOnce({ share_code: myShareCode() });
    const referredBy = load<string>("cs.referredBy", "");
    if (referredBy && !load<boolean>("cs.referralSent", false)) {
      setPersonOnce({ referred_by: referredBy });
      track("referred_signin", { ref: referredBy });
      save("cs.referralSent", true);
    }
    const saved = load<string[]>("cs.cards", []);
    setMyCardIds(saved);
    setOnboarded(load<boolean>("cs.onboarded", saved.length > 0));
    setLedger(load<LedgerEntry[]>("cs.ledger", []));
    setMet(load<string[]>("cs.conditions", []));
    setRecent(load<string[]>("cs.recent", []));
    const t = load<ThemeChoice>("cs.theme", "system");
    setTheme(t);
    applyTheme(t);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => load<ThemeChoice>("cs.theme", "system") === "system" && applyTheme("system");
    mq.addEventListener("change", onChange);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onInstalled = () => track("app_installed");
    window.addEventListener("appinstalled", onInstalled);
    track("app_opened", {
      installed: window.matchMedia("(display-mode: standalone)").matches,
      cards_held: saved.length,
      theme: t,
    });
    setReady(true);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const myCards = useMemo(() => ALL_CARDS.filter((c) => myCardIds.includes(c.id)), [myCardIds]);
  const states = useMemo(() => statesFromLedger(myCards, ledger, met), [myCards, ledger, met]);
  const offerCtx: OfferContext = useMemo(() => ({ offers: ALL_OFFERS, today: new Date(), uses: offerUsesFromLedger(ledger) }), [ledger]);
  const results: Recommendation[] = useMemo(() => (lookup ? recommend(myCards, lookup, states, offerCtx) : []), [lookup, myCards, states, offerCtx]);
  const hints = useMemo(() => (lookup ? merchantHints(myCards, lookup, states, MERCHANTS, 4, offerCtx) : []), [lookup, myCards, states, offerCtx]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  }, []);

  const toggleCard = (id: string) => {
    const added = !myCardIds.includes(id);
    const next = added ? [...myCardIds, id] : myCardIds.filter((x) => x !== id);
    setMyCardIds(next);
    save("cs.cards", next);
    track(added ? "card_added" : "card_removed", { card: id, cards_held: next.length });
  };
  const toggleCondition = (key: string) => {
    const next = met.includes(key) ? met.filter((x) => x !== key) : [...met, key];
    setMet(next);
    save("cs.conditions", next);
  };

  function startLookup(l: Lookup, source: string, parsedBy = "", query?: string) {
    setLookup(l);
    setParser(parsedBy);
    setPaidWith(null);
    setPaidTs(null);
    setError("");
    const top = recommend(myCards, l, states, offerCtx).find((r) => r.usable);
    track("lookup", {
      source,
      parser: parsedBy || "tile",
      merchant: l.merchant,
      category: l.category,
      rail: l.rail,
      channel: l.channel,
      amount_range: amountBucket(l.amount),
      cards_held: myCards.length,
      best_card: top?.cardId,
      best_pct: top?.effectivePct,
      best_offer: top?.offer?.id,
      best_total_inr: top?.totalInr,
      near_offers: top?.offerHints?.length ?? 0,
      // What was typed (text lookups only, first 80 characters), so wrong reads can be fixed.
      query: query?.slice(0, 80),
      merchant_hints: merchantHints(myCards, l, states, MERCHANTS, 4, offerCtx).map((h) => h.merchantId),
    });
  }

  async function askText(q: string) {
    setBusy(true);
    setError("");
    setNote(undefined);
    const nextRecent = [q, ...recent.filter((r) => r !== q)].slice(0, 5);
    try {
      const res = await fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: q }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setNote(data.note);
      setRecent(nextRecent);
      save("cs.recent", nextRecent);
      if (!(Number(data.lookup.amount) > 0)) {
        // No amount in what they typed: ask for it instead of showing ₹0.
        setNeedAmount({ lookup: { ...data.lookup, amount: 0 }, query: q, parser: data.parser });
        track("amount_missing", { query: q.slice(0, 80), merchant: data.lookup.merchant, category: data.lookup.category });
        return;
      }
      startLookup(data.lookup, "text", data.parser, q);
    } catch (e) {
      const local = localParse(q);
      if (local) {
        startLookup(local, "text", "local", q);
        setRecent(nextRecent);
        save("cs.recent", nextRecent);
      } else setError(e instanceof Error ? e.message : "Add an amount, like “dinner 2400”.");
    } finally {
      setBusy(false);
    }
  }

  /** A change made on the answer screen (edit panel or a shop hint): it's a new answer, so it can be logged again. */
  function editLookup(next: Lookup) {
    setLookup(next);
    setPaidWith(null);
    setPaidTs(null);
  }

  function markPaid(r: Recommendation) {
    if (!lookup) return;
    const best = results.find((x) => x.usable);
    const merchant = MERCHANTS.find((m) => m.id === lookup.merchant);
    const entry: LedgerEntry = {
      ts: Date.now(),
      cardId: r.cardId,
      capConsumption: r.capConsumption,
      amount: lookup.amount,
      earned: r.totalInr,
      best: best?.totalInr,
      bestCardId: best?.cardId,
      label: merchant?.name ?? pretty(lookup.category),
      offerId: r.offer?.id,
      discount: r.offer?.discountInr,
    };
    const replaced = paidTs !== null;
    const next = [...ledger.filter((e) => e.ts !== paidTs), entry];
    setLedger(next);
    save("cs.ledger", next);
    setPaidWith(r.cardId);
    setPaidTs(entry.ts);
    showToast(replaced ? "Changed to this card. Limits and savings updated." : "Payment logged. Limits and savings updated.");
    track("paid", {
      replaced,
      card: r.cardId,
      is_best: r.cardId === best?.cardId,
      value_inr: r.totalInr,
      best_value_inr: best?.totalInr,
      missed_inr: Math.max(0, (best?.totalInr ?? 0) - r.totalInr),
      category: lookup.category,
      merchant: lookup.merchant,
      offer_id: r.offer?.id,
      discount_inr: r.offer?.discountInr,
    });
  }

  function removePayment(ts: number) {
    const entry = ledger.find((e) => e.ts === ts);
    if (!entry) return;
    const next = ledger.filter((e) => e.ts !== ts);
    setLedger(next);
    save("cs.ledger", next);
    if (ts === paidTs) {
      setPaidTs(null);
      setPaidWith(null);
    }
    showToast("Payment removed. Limits and savings updated.");
    track("payment_removed", { card: entry.cardId, minutes_after: Math.round((Date.now() - entry.ts) / 60000), value_inr: entry.earned });
  }

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
    track("install_prompt");
  }

  if (!ready) return null;

  if (!onboarded) {
    return (
      <main className="app">
        <Onboarding
          selected={myCardIds}
          onToggle={toggleCard}
          met={met}
          onToggleCondition={toggleCondition}
          states={states}
          canInstall={!!installPrompt}
          onInstall={install}
          onDone={() => {
            setOnboarded(true);
            save("cs.onboarded", true);
            setTab("pay");
            track("onboarded", { cards_held: myCardIds.length, cards: myCardIds });
          }}
        />
      </main>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <span className="brand">Kaunsa Card</span>
        <button type="button" className="icon-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <IconSettings />
        </button>
      </header>

      {tab === "pay" &&
        (myCards.length === 0 ? (
          <div className="screen">
            <h1 className="hero">Add your cards first</h1>
            <p className="muted">Lookups compare the cards you carry.</p>
            <button type="button" className="btn primary" onClick={() => setTab("cards")}>
              Add my cards
            </button>
          </div>
        ) : (
          <PayTab
            onLookup={(l, src) => startLookup(l, src)}
            pending={needAmount?.lookup ?? null}
            onPendingDone={(l) => {
              const p = needAmount;
              setNeedAmount(null);
              startLookup(l, "text", p?.parser ?? "", p?.query);
            }}
            onPendingCancel={() => setNeedAmount(null)}
            onText={askText}
            busy={busy}
            error={error}
            recent={recent}
            hasResult={!!lookup}
            onBack={() => setLookup(null)}
          >
            {lookup && (
              <Result
                lookup={lookup}
                setLookup={editLookup}
                results={results}
                hints={hints}
                parser={parser}
                note={note}
                paidWith={paidWith}
                onPaid={markPaid}
                onToast={showToast}
              />
            )}
          </PayTab>
        ))}
      {tab === "cards" && <CardsTab cards={myCards} states={states} selected={myCardIds} onToggle={toggleCard} met={met} onToggleCondition={toggleCondition} />}
      {tab === "savings" && <SavingsTab ledger={ledger} onRemove={removePayment} />}
      {tab === "advisor" && <AdvisorTab myCards={myCards} onEditCards={() => setTab("cards")} />}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <nav className="tabbar" aria-label="Sections">
        {(
          [
            ["pay", "Pay", <IconPay key="p" />],
            ["cards", "My cards", <IconCards key="c" />],
            ["savings", "Savings", <IconSavings key="s" />],
            ["advisor", "Advisor", <IconAdvisor key="a" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button type="button" key={id} className={tab === id ? "on" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {settingsOpen && (
        <Settings
          user={user}
          onSignOut={async () => {
            track("signed_out");
            resetUser();
            await signOutOfApp();
          }}
          theme={theme}
          onTheme={(t) => {
            setTheme(t);
            save("cs.theme", t);
            applyTheme(t);
            track("theme_changed", { theme: t });
          }}
          canInstall={!!installPrompt}
          onInstall={install}
          onReplay={() => {
            setSettingsOpen(false);
            setOnboarded(false);
          }}
          onClear={() => {
            for (const k of ["cs.cards", "cs.ledger", "cs.conditions", "cs.recent", "cs.onboarded", "cs.advisor", "cs.shareCode", "cs.referredBy", "cs.referralSent"]) localStorage.removeItem(k);
            setMyCardIds([]);
            setLedger([]);
            setMet([]);
            setRecent([]);
            setLookup(null);
            setSettingsOpen(false);
            setOnboarded(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
