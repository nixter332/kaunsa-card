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
  const merchant = input.merchant === "unknown" ? undefined : String(input.merchant);
  return {
    merchant,
    merchantText: input.merchant_text ? String(input.merchant_text) : undefined,
    category: input.category as Lookup["category"],
    amount: Number(input.amount),
    channel: input.channel as Lookup["channel"],
    rail: input.rail as Lookup["rail"],
  };
}
