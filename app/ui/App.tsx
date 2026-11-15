"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { amountBucket, identifyUser, resetUser, setPersonOnce } from "@/lib/analytics";
import { signOutOfApp } from "../actions";
import { merchantHints, recommend, type OfferContext } from "@/lib/engine";
import { offersForCards } from "@/lib/offers";
import { instantRead, localParse, MERCHANTS } from "@/lib/localParse";
import type { Lookup, Recommendation } from "@/lib/types";
import { AdvisorTab } from "./AdvisorTab";
import { CardsTab } from "./CardsTab";
import { IconAdvisor, IconCards, IconPay, IconSavings, IconSettings } from "./Icons";
import { Onboarding } from "./Onboarding";
import { PayTab, type CapRoom, type Preview } from "./PayTab";
import { Result } from "./Result";
import { SavingsTab } from "./SavingsTab";
import { myShareCode } from "./referral";
import { Settings, type ThemeChoice } from "./Settings";
import { GmailSync } from "./GmailSync";
import { fetchAlertEmails, gmailToken, revokeGmail } from "./gmail";
import { parseAlert } from "@/lib/alerts";
import { importAlerts, type Incoming, type Unmatched } from "@/lib/importAlerts";
import { ALL_CARDS, ALL_OFFERS, load, offerUsesFromLedger, pretty, save, statesFromLedger, track, type LedgerEntry } from "./store";

type Tab = "pay" | "cards" | "savings" | "advisor";
type InstallPrompt = Event & { prompt: () => Promise<void> };

function applyTheme(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0d1311" : "#f3f6f4");
}

export type AppUser = { id: string; name: string; email: string; image?: string };

export function App({ user, googleClientId }: { user: AppUser; googleClientId?: string }) {
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
  // True right after onboarding, so My cards opens with a short welcome above the playbook.
  const [justOnboarded, setJustOnboarded] = useState(false);
  // Gmail import (all on this phone): whether it's connected, last sync, card numbers learned, payments to ask about.
  const [gmail, setGmail] = useState({ connected: false, lastSync: 0 });
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>();
  const [last4, setLast4] = useState<Record<string, string>>({});
  const [ignoredLast4, setIgnoredLast4] = useState<string[]>([]);
  const [unmatched, setUnmatched] = useState<Unmatched[]>([]);
  const [heldAlerts, setHeldAlerts] = useState<Incoming[]>([]);

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
    setGmail(load("cs.gmail", { connected: false, lastSync: 0 }));
    setLast4(load<Record<string, string>>("cs.last4", {}));
    setIgnoredLast4(load<string[]>("cs.ignoredLast4", []));
    setHeldAlerts(load<Incoming[]>("cs.heldAlerts", []));
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

  // "On your cards" on the Pay screen: live offers (time-limited bank offers before lasting perks), and the
  // bonus limits that are closest to full.
  const homeOffers = useMemo(
    () => offersForCards(ALL_OFFERS, myCards, new Date()).sort((a, b) => Number(b.offer.kind === "bank_offer") - Number(a.offer.kind === "bank_offer")),
    [myCards],
  );
  const capRoom: CapRoom[] = useMemo(
    () =>
      myCards
        .flatMap((card) =>
          card.caps.map((cap) => {
            const used = states[card.id]?.capUsed[cap.id] ?? 0;
            const leftInr = Math.max(0, cap.amount - used) * card.reward.inrPerUnit;
            return { key: `${card.id}|${cap.id}`, cardName: card.name, leftInr, period: cap.period, label: cap.label, ratio: used / cap.amount };
          }),
        )
        .filter((c) => c.ratio > 0)
        .sort((a, b) => b.ratio - a.ratio)
        .map(({ ratio: _r, ...c }) => c),
    [myCards, states],
  );

  // In the first days of a month, for people who logged payments last month: their limits are fresh again.
  const monthNote = useMemo(() => {
    const now = new Date();
    if (now.getDate() > 3) return undefined;
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const logged = ledger.some((e) => {
      const d = new Date(e.ts);
      return d.getMonth() === prev.getMonth() && d.getFullYear() === prev.getFullYear();
    });
    return logged ? `It's a new month: your monthly bonus limits have reset.` : undefined;
  }, [ledger]);

  /** Add read alerts to the ledger (same valuation as "I paid"), and hold back the ones whose card isn't known yet. */
  function applyAlerts(incoming: Incoming[], map: Record<string, string>, ignored: string[]) {
    const r = importAlerts({
      incoming,
      ledger,
      cards: myCards,
      last4: map,
      ignoredLast4: ignored,
      states: (l, at) => statesFromLedger(myCards, l as LedgerEntry[], met, at),
    });
    setLedger(r.ledger);
    save("cs.ledger", r.ledger);
    const nextMap = { ...map, ...r.learned };
    setLast4(nextMap);
    save("cs.last4", nextMap);
    const held = incoming.filter((t) => r.unmatched.some((u) => u.msgId === t.msgId));
    setHeldAlerts(held);
    save("cs.heldAlerts", held);
    setUnmatched(r.unmatched);
    return r;
  }

  async function syncGmail() {
    if (!googleClientId) return;
    setSyncing(true);
    setSyncStatus(undefined);
    const firstTime = !gmail.connected;
    if (firstTime) track("gmail_connect_clicked", { cards_held: myCards.length });
    try {
      const token = await gmailToken({ firstTime, email: user.email });
      // First time: from the start of last month, so this month's limits are right. Later: since the last sync, with a day's overlap.
      const now = new Date();
      const from = gmail.lastSync ? gmail.lastSync - 86_400_000 : new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      const emails = await fetchAlertEmails(token, Math.floor(from / 1000));
      const parsed: Incoming[] = [];
      const unread: string[] = [];
      for (const e of emails) {
        const t = parseAlert(e.text);
        if (t) parsed.push({ ...t, msgId: e.id, fallbackTs: e.internalDate });
        else unread.push((/@([\w.-]+)/.exec(e.from)?.[1] ?? "unknown").toLowerCase());
      }
      const r = applyAlerts([...heldAlerts, ...parsed], last4, ignoredLast4);
      const next = { connected: true, lastSync: Date.now() };
      setGmail(next);
      save("cs.gmail", next);
      setSyncStatus(r.added ? `added ${r.added} payment${r.added === 1 ? "" : "s"}` : "no new payments");
      showToast(r.added ? `Added ${r.added} payment${r.added === 1 ? "" : "s"} from Gmail. Limits and savings updated.` : "No new card payments in Gmail.");
      if (firstTime) track("gmail_connected", {});
      track("gmail_synced", {
        emails: emails.length,
        read: parsed.length,
        added: r.added,
        skipped: r.skipped,
        unmatched: r.unmatched.length,
        unknown_merchant: r.unknownMerchant,
        banks: [...new Set(parsed.map((p) => p.issuer))],
        // Sender domains of alerts we couldn't read, to know which bank formats to add next (no content).
        unread_senders: [...new Set(unread)].slice(0, 10),
      });
    } catch (e) {
      const kind = e instanceof Error ? e.message : "error";
      const msg: Record<string, string> = {
        denied: "Gmail access wasn't allowed, so nothing was read.",
        closed: "The Google window was closed before finishing.",
        blocked: "Your browser blocked Google's window. Allow pop-ups for this site and try again.",
        expired: "Gmail access ran out. Tap Sync again.",
      };
      setSyncStatus("sync didn't finish");
      showToast(msg[kind] ?? "Couldn't reach Gmail. Try again in a bit.");
      track("gmail_error", { kind: kind.slice(0, 40), first_time: firstTime });
    } finally {
      setSyncing(false);
    }
  }

  function linkCard(u: Unmatched, cardId: string) {
    const map = u.last4 ? { ...last4, [cardId]: u.last4 } : last4;
    // Without last 4 digits there's nothing to remember: assign just this payment to the card.
    const incoming = u.last4 ? heldAlerts : heldAlerts.map((t) => (t.msgId === u.msgId ? { ...t, last4: undefined, issuer: myCards.find((c) => c.id === cardId)!.issuer, cardHint: myCards.find((c) => c.id === cardId)!.name.toLowerCase() } : t));
    const r = applyAlerts(incoming, map, ignoredLast4);
    track("gmail_card_linked", { card: cardId, added: r.added });
    showToast(r.added ? `Added ${r.added} payment${r.added === 1 ? "" : "s"}.` : "Saved.");
  }

  function ignoreCard(u: Unmatched) {
    const ignored = u.last4 ? [...ignoredLast4, u.last4] : ignoredLast4;
    setIgnoredLast4(ignored);
    save("cs.ignoredLast4", ignored);
    const held = heldAlerts.filter((t) => (u.last4 ? t.last4 !== u.last4 : t.msgId !== u.msgId));
    setHeldAlerts(held);
    save("cs.heldAlerts", held);
    setUnmatched((list) => list.filter((x) => (u.last4 ? x.last4 !== u.last4 : x.msgId !== u.msgId)));
    track("gmail_card_ignored", { issuer: u.issuer });
  }

  function disconnectGmail() {
    revokeGmail();
    for (const k of ["cs.gmail", "cs.heldAlerts"]) localStorage.removeItem(k);
    setGmail({ connected: false, lastSync: 0 });
    setHeldAlerts([]);
    setUnmatched([]);
    track("gmail_disconnected");
  }

  /** The best card for a lookup, for live previews on the Pay screen (same engine as the full answer). */
  const preview = useCallback(
    (l: Lookup): Preview | undefined => {
      const r = recommend(myCards, l, states, offerCtx).find((x) => x.usable);
      return r && r.totalInr > 0 ? { cardId: r.cardId, cardName: r.cardName, pct: r.effectivePct, totalInr: r.totalInr, hasOffer: Boolean(r.offer) } : undefined;
    },
    [myCards, states, offerCtx],
  );

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
    // A known shop and an amount need no AI: answer at once, on the device.
    const instant = instantRead(q).lookup;
    if (instant) {
      setRecent(nextRecent);
      save("cs.recent", nextRecent);
      startLookup(instant, "text", "instant", q);
      setBusy(false);
      return;
    }
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
          onDone={() => {
            setOnboarded(true);
            save("cs.onboarded", true);
            setJustOnboarded(true);
            setTab("cards");
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
            offers={homeOffers}
            caps={capRoom}
            preview={preview}
            monthNote={monthNote}
            top={
              googleClientId ? (
                <GmailSync
                  clientId={googleClientId}
                  connected={gmail.connected}
                  lastSync={gmail.lastSync || undefined}
                  syncing={syncing}
                  status={syncStatus}
                  unmatched={unmatched.length ? unmatched : heldAlerts.map((t) => ({ msgId: t.msgId, issuer: t.issuer, last4: t.last4, amount: t.amount, label: t.merchant?.name ?? t.merchantRaw, ts: t.ts ?? t.fallbackTs }))}
                  cards={myCards}
                  onSync={syncGmail}
                  onLinkCard={linkCard}
                  onIgnore={ignoreCard}
                />
              ) : undefined
            }
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
      {tab === "cards" && (
        <CardsTab
          cards={myCards}
          states={states}
          selected={myCardIds}
          onToggle={toggleCard}
          met={met}
          onToggleCondition={toggleCondition}
          welcome={justOnboarded}
          onToast={showToast}
          onLookup={(l) => {
            setJustOnboarded(false);
            startLookup(l, "playbook");
            setTab("pay");
          }}
        />
      )}
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
          gmailConnected={gmail.connected}
          onDisconnectGmail={disconnectGmail}
          onClear={() => {
            revokeGmail();
            for (const k of ["cs.cards", "cs.ledger", "cs.conditions", "cs.recent", "cs.onboarded", "cs.advisor", "cs.shareCode", "cs.referredBy", "cs.referralSent", "cs.gmail", "cs.last4", "cs.ignoredLast4", "cs.heldAlerts"]) localStorage.removeItem(k);
            setGmail({ connected: false, lastSync: 0 });
            setLast4({});
            setIgnoredLast4([]);
            setHeldAlerts([]);
            setUnmatched([]);
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
