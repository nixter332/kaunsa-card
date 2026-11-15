// Gmail, read on the phone. Google's token client (loaded from accounts.google.com) gives this browser a
// one-hour, read-only Gmail token after a tap; the token and the emails never go to our server.
import { GMAIL_QUERY, htmlToLines } from "@/lib/alerts";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

type TokenResponse = { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
type TokenClient = { requestAccessToken: (o?: { prompt?: string; login_hint?: string }) => void };
type GoogleOAuth = {
  accounts: {
    oauth2: {
      initTokenClient: (c: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type?: string; message?: string }) => void;
      }) => TokenClient;
      revoke: (token: string, done?: () => void) => void;
      hasGrantedAllScopes: (r: TokenResponse, ...scopes: string[]) => boolean;
    };
  };
};

let script: Promise<void> | null = null;
let client: TokenClient | null = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
let token: { value: string; expires: number } | null = null;

const google = () => (window as unknown as { google?: GoogleOAuth }).google;

/** Load Google's script ahead of time, so the tap can open the popup straight away (browsers block late popups). */
export function prepareGmail(clientId: string): Promise<void> {
  if (!script) {
    script = new Promise((resolve, reject) => {
      if (google()?.accounts?.oauth2) return resolve();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        script = null;
        reject(new Error("Couldn't load Google sign-in"));
      };
      document.head.appendChild(s);
    });
  }
  return script.then(() => {
    if (client) return;
    client = google()!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        const p = pending;
        pending = null;
        if (!p) return;
        // Google shows Gmail as a separate checkbox; if it was left unticked the token can't read mail.
        if (r.access_token && !google()!.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) {
          p.reject(new Error("scope"));
          return;
        }
        if (r.access_token) {
          token = { value: r.access_token, expires: Date.now() + ((r.expires_in ?? 3600) - 60) * 1000 };
          p.resolve(r.access_token);
        } else p.reject(new Error(r.error === "access_denied" ? "denied" : r.error ?? "no token"));
      },
      error_callback: (e) => {
        const p = pending;
        pending = null;
        p?.reject(new Error(e.type === "popup_closed" ? "closed" : e.type === "popup_failed_to_open" ? "blocked" : e.type ?? "error"));
      },
    });
  });
}

/** A Gmail token. Call from a tap. Reuses this visit's token if it's still valid. */
export function gmailToken(opts: { firstTime: boolean; email: string }): Promise<string> {
  if (token && token.expires > Date.now()) return Promise.resolve(token.value);
  if (!client) return Promise.reject(new Error("not ready"));
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client!.requestAccessToken({ prompt: opts.firstTime ? "consent" : "", login_hint: opts.email });
  });
}

/** Forget this browser's Gmail access and ask Google to revoke it. */
export function revokeGmail() {
  if (token) google()?.accounts.oauth2.revoke(token.value);
  token = null;
}

export type GmailMessage = { id: string; internalDate: number; from: string; text: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(path: string, accessToken: string, attempt = 0): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) {
    token = null;
    throw new Error("expired");
  }
  if (!res.ok) {
    // Keep Google's reason (e.g. "Gmail API has not been used in project … or it is disabled") for the message and analytics.
    let reason = "";
    try {
      reason = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
    } catch {}
    // Gmail limits how much each person's mail can be read per minute. Google's advice: wait and retry, waiting longer each time.
    const rate = res.status === 429 || (res.status === 403 && /quota|rate ?limit/i.test(reason));
    if (rate && attempt < 3) {
      await sleep(2000 * 2 ** attempt + Math.random() * 500);
      return api<T>(path, accessToken, attempt + 1);
    }
    const kind = rate
      ? "rate"
      : res.status === 403 && /has not been used|is disabled|not enabled/i.test(reason)
        ? "api_off"
        : res.status === 403 && /insufficient|scope/i.test(reason)
          ? "scope"
          : `gmail ${res.status}`;
    // Google's own wording rides along (it names no person or email), so analytics shows the real cause.
    throw Object.assign(new Error(kind), { reason });
  }
  return res.json() as Promise<T>;
}

function decode(data: string): string {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };

function bodyText(part: Part): { plain: string; html: string } {
  let plain = "";
  let html = "";
  const walk = (p: Part) => {
    if (p.body?.data && p.mimeType === "text/plain") plain += decode(p.body.data) + "\n";
    else if (p.body?.data && p.mimeType === "text/html") html += decode(p.body.data) + "\n";
    p.parts?.forEach(walk);
  };
  walk(part);
  return { plain, html };
}

export type AlertFetch = {
  emails: GmailMessage[];
  /** False when Google asked us to slow down or there were more emails than one sync reads; `upTo` is how far we got. */
  complete: boolean;
  upTo?: number;
};

/**
 * Card alert emails received after `afterSec` (Unix seconds), oldest first, as plain text with the subject on top.
 * Reads at most `max` emails, 3 at a time, so one sync stays well inside Gmail's per-minute limit for a person.
 * If Google still says "slow down", it keeps what was read so far and the next sync carries on from there.
 */
export async function fetchAlertEmails(accessToken: string, afterSec: number, max = 120): Promise<AlertFetch> {
  const q = `${GMAIL_QUERY} after:${afterSec}`;
  const ids: string[] = [];
  let pageToken = "";
  do {
    const page = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(
      `/messages?maxResults=100&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${pageToken}` : ""}`,
      accessToken,
    );
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken && ids.length < 500);
  // Gmail lists newest first. Read oldest first, so a sync cut short can pick up where it stopped.
  const todo = ids.reverse().slice(0, max);
  let complete = !pageToken && ids.length <= max;

  const out: GmailMessage[] = [];
  for (let i = 0; i < todo.length; i += 3) {
    let batch: { id: string; internalDate: string; payload: Part }[];
    try {
      batch = await Promise.all(todo.slice(i, i + 3).map((id) => api<{ id: string; internalDate: string; payload: Part }>(`/messages/${id}?format=full`, accessToken)));
    } catch (e) {
      if (e instanceof Error && e.message === "rate" && out.length) {
        complete = false;
        break;
      }
      throw e;
    }
    for (const m of batch) {
      const headers = m.payload.headers ?? [];
      const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
      const from = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
      const { plain, html } = bodyText(m.payload);
      out.push({ id: m.id, internalDate: Number(m.internalDate), from, text: `${subject}\n${plain.trim() ? plain : htmlToLines(html)}` });
    }
  }
  return { emails: out, complete, upTo: out.length ? Math.max(...out.map((m) => m.internalDate)) : undefined };
}
