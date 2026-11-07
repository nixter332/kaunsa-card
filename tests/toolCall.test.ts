import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { callTool } from "../lib/toolCall";

// A fake client that replays canned responses and records each request.
function fakeClient(responses: Partial<Anthropic.Message>[]) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        calls.push(JSON.parse(JSON.stringify(params)));
        return responses.shift();
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const base = { model: "m", max_tokens: 100, tools: [], messages: [{ role: "user" as const, content: "zomato 650" }] };

describe("callTool", () => {
  it("uses tool_choice auto and returns the tool input", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "record_purchase", input: { amount: 650 } } as Anthropic.ToolUseBlock] },
    ]);
    expect(await callTool(client, base, "record_purchase")).toEqual({ amount: 650 });
    expect(calls[0].tool_choice).toEqual({ type: "auto" });
  });

  it("retries once with a nudge when the model replies in text", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "end_turn", content: [{ type: "text", text: "Sure!", citations: null } as Anthropic.TextBlock] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "record_purchase", input: { amount: 650 } } as Anthropic.ToolUseBlock] },
    ]);
    expect(await callTool(client, base, "record_purchase")).toEqual({ amount: 650 });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1].messages)).toMatch(/calling the record_purchase tool/);
  });

  it("gives up after two text replies", async () => {
    const text = { stop_reason: "end_turn" as const, content: [{ type: "text", text: "no", citations: null } as Anthropic.TextBlock] };
    const { client } = fakeClient([text, { ...text }]);
    await expect(callTool(client, base, "record_purchase")).rejects.toThrow(/did not call/);
  });
});
