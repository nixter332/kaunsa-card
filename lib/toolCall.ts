// Get structured output from a tool call.
// Newer Claude models don't support forced tool use (tool_choice "tool"/"any"),
// so we use tool_choice "auto", tell the model to call the tool, and retry once if it doesn't.
import Anthropic from "@anthropic-ai/sdk";

type Params = Omit<Anthropic.MessageCreateParamsNonStreaming, "tool_choice">;

export async function callTool<T = Record<string, unknown>>(client: Anthropic, params: Params, toolName: string): Promise<T> {
  const messages = [...params.messages];
  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await client.messages.create({ ...params, messages, tool_choice: { type: "auto" } });
    const block = msg.content.find((b) => b.type === "tool_use" && b.name === toolName);
    if (block && block.type === "tool_use") return block.input as T;
    if (msg.stop_reason === "max_tokens") throw new Error("Response hit max_tokens before calling the tool; raise max_tokens.");
    messages.push({ role: "assistant", content: msg.content });
    messages.push({ role: "user", content: `Please answer by calling the ${toolName} tool now. Do not reply in text.` });
  }
  throw new Error(`Model did not call ${toolName}`);
}
