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

async function api<T>(path: string, accessToken: string): Promise<T> {
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
    if (res.status === 403 && /has not been used|is disabled|not enabled/i.test(reason)) throw new Error("api_off");
    if (res.status === 403) throw new Error("scope");
    throw new Error(`gmail ${res.status} ${reason}`.trim());
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

/** Card alert emails received after `afterSec` (Unix seconds), as plain text with the subject on top. */
export async function fetchAlertEmails(accessToken: string, afterSec: number, max = 250): Promise<GmailMessage[]> {
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
  } while (pageToken && ids.length < max);

  const out: GmailMessage[] = [];
  for (let i = 0; i < Math.min(ids.length, max); i += 6) {
    const batch = await Promise.all(
      ids.slice(i, i + 6).map((id) => api<{ id: string; internalDate: string; payload: Part }>(`/messages/${id}?format=full`, accessToken)),
    );
    for (const m of batch) {
      const headers = m.payload.headers ?? [];
      const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
      const from = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
      const { plain, html } = bodyText(m.payload);
      out.push({ id: m.id, internalDate: Number(m.internalDate), from, text: `${subject}\n${plain.trim() ? plain : htmlToLines(html)}` });
    }
  }
  return out;
}
