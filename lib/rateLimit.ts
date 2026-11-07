// Daily limits on AI lookups, so a public link can't run up the Claude bill.
// Uses Upstash Redis (free tier, added from the Vercel Marketplace) when configured;
// otherwise falls back to an in-memory counter, which only limits per server instance.
// The monthly spend limit on the Claude Console is the final backstop either way.

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 300); // all users combined
const PER_IP_LIMIT = Number(process.env.AI_PER_IP_DAILY_LIMIT ?? 30); // one person

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

const memory = new Map<string, number>();

async function incr(key: string): Promise<number> {
  if (REDIS_URL && REDIS_TOKEN) {
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, 60 * 60 * 26],
      ]),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Redis error ${res.status}`);
    const [first] = (await res.json()) as { result: number }[];
    return first.result;
  }
  const next = (memory.get(key) ?? 0) + 1;
  memory.set(key, next);
  return next;
}

export type LimitResult = { ok: true } | { ok: false; reason: "daily" | "person" | "error" };

/** Call once per AI lookup. Counts it, and says whether it's allowed. */
export async function allowAiLookup(who: string, now = new Date()): Promise<LimitResult> {
  // Days run on India time so the limit resets at midnight IST.
  const day = new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  try {
    // Keyed by Google account id since sign-in (the key name is kept so existing counters carry on).
    if ((await incr(`ai:ip:${who}:${day}`)) > PER_IP_LIMIT) return { ok: false, reason: "person" };
    if ((await incr(`ai:all:${day}`)) > DAILY_LIMIT) return { ok: false, reason: "daily" };
    return { ok: true };
  } catch {
    // If the counter is down, fail closed: use the free on-device parser rather than risk cost.
    return { ok: false, reason: "error" };
  }
}

export const LIMITS = { DAILY_LIMIT, PER_IP_LIMIT, usingRedis: Boolean(REDIS_URL && REDIS_TOKEN) };
