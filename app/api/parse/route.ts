import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { parseWithClaude } from "@/lib/claude";
import { localParse } from "@/lib/localParse";
import { allowAiLookup } from "@/lib/rateLimit";

const LIMIT_NOTES = {
  person: "You've used today's AI lookups, so this was read on-device.",
  daily: "Today's AI lookups are used up, so this was read on-device.",
  error: "AI lookups are paused right now, so this was read on-device.",
};

export async function POST(req: Request) {
  // Only signed-in people can use AI lookups (and the Claude bill).
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { text } = (await req.json()) as { text?: string };
  if (!text || text.length > 200) return NextResponse.json({ error: "Type a short purchase, e.g. 'zomato 650'" }, { status: 400 });

  let note: string | undefined;
  if (process.env.ANTHROPIC_API_KEY) {
    // Daily limit per person (their Google account), not per network.
    const who = session.user.id ?? session.user.email ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const limit = await allowAiLookup(who);
    if (limit.ok) {
      try {
        const lookup = await parseWithClaude(text);
        // Worth knowing when the two readers disagree on the amount (no text is logged, only the numbers).
        const local = localParse(text)?.amount;
        if (local && lookup.amount && local !== lookup.amount) console.warn(`Amount mismatch: Claude ${lookup.amount}, on-device ${local}`);
        return NextResponse.json({ lookup, parser: "claude" });
      } catch (e) {
        console.error("Claude parse failed, falling back:", e);
      }
    } else {
      note = LIMIT_NOTES[limit.reason];
    }
  }
  const lookup = localParse(text);
  if (!lookup) return NextResponse.json({ error: "Couldn't find an amount. Try 'dinner 2400'." }, { status: 422 });
  return NextResponse.json({ lookup, parser: "local", note });
}
