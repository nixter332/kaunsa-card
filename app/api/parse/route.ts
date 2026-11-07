import { NextResponse } from "next/server";
import { parseWithClaude } from "@/lib/claude";
import { localParse } from "@/lib/localParse";
import { allowAiLookup } from "@/lib/rateLimit";

const LIMIT_NOTES = {
  person: "You've used today's AI lookups, so this was read on-device.",
  daily: "Today's AI lookups are used up, so this was read on-device.",
  error: "AI lookups are paused right now, so this was read on-device.",
};

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  if (!text || text.length > 200) return NextResponse.json({ error: "Type a short purchase, e.g. 'zomato 650'" }, { status: 400 });

  let note: string | undefined;
  if (process.env.ANTHROPIC_API_KEY) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const limit = await allowAiLookup(ip);
    if (limit.ok) {
      try {
        const lookup = await parseWithClaude(text);
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
