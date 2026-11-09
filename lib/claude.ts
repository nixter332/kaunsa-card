// Server-only: turns free text into a structured Lookup using Claude tool calling.
// The model only UNDERSTANDS the request. It never sees or produces reward rates.
import Anthropic from "@anthropic-ai/sdk";
import { MERCHANTS } from "./localParse";
import { callTool } from "./toolCall";
import { CATEGORIES, type Lookup } from "./types";

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5";

const lookupTool: Anthropic.Tool = {
  name: "record_purchase",
  description: "Record the structured details of a purchase the user is about to make in India.",
  input_schema: {
    type: "object",
    properties: {
      merchant: {
        type: "string",
        enum: [...MERCHANTS.map((m) => m.id), "unknown"],
        description: "Known merchant id, or 'unknown' if none fits.",
      },
      merchant_text: { type: "string", description: "The merchant as the user wrote it." },
      category: { type: "string", enum: [...CATEGORIES], description: "Spend category. Dine-in at a restaurant or café is 'dining'." },
      amount: { type: "number", description: "Amount in rupees. '1.2k' = 1200. Use 0 if the user gave no amount; never guess one." },
      channel: { type: "string", enum: ["online", "offline"], description: "Online = app/website. Offline = in a shop or restaurant." },
      rail: { type: "string", enum: ["card", "upi"], description: "'upi' only if the user says UPI, QR, GPay, PhonePe or Paytm. Otherwise 'card'." },
    },
    required: ["merchant", "category", "amount", "channel", "rail"],
  },
};

export async function parseWithClaude(text: string): Promise<Lookup & { merchantText?: string }> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const merchantList = MERCHANTS.map((m) => `${m.id}: ${m.name} (${m.category})`).join("\n");
  const input = await callTool(
    client,
    {
      model: MODEL,
      max_tokens: 2000,
      tools: [lookupTool],
      system:
        `You extract purchase details for an Indian credit-card rewards app. ` +
        `Always respond by calling the record_purchase tool exactly once; never reply in plain text. Known merchants:\n${merchantList}`,
      messages: [{ role: "user", content: text }],
    },
    "record_purchase",
  );
  return lookupFromTool(input);
}

/**
 * Check the model's answer before the rules engine sees it. A spend type, channel or rail outside
 * the allowed values throws, so the route falls back to the on-device parser. An unknown merchant
 * is dropped, and a missing or negative amount becomes 0 (the app then asks for it).
 */
export function lookupFromTool(input: Record<string, unknown>): Lookup & { merchantText?: string } {
  const category = String(input.category) as Lookup["category"];
  const channel = String(input.channel) as Lookup["channel"];
  const rail = String(input.rail) as Lookup["rail"];
  if (!CATEGORIES.includes(category)) throw new Error(`Model gave unknown category "${category}"`);
  if (channel !== "online" && channel !== "offline") throw new Error(`Model gave unknown channel "${channel}"`);
  if (rail !== "card" && rail !== "upi") throw new Error(`Model gave unknown rail "${rail}"`);
  const merchant = MERCHANTS.some((m) => m.id === input.merchant) ? String(input.merchant) : undefined;
  const amount = Number(input.amount);
  return {
    merchant,
    merchantText: input.merchant_text ? String(input.merchant_text) : undefined,
    category,
    amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0,
    channel,
    rail,
  };
}
