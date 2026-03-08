import Anthropic from "@anthropic-ai/sdk";
import type { HomeyClient } from "./homey-client.js";
import { homeyTools, executeHomeyTool } from "./claude-tools.js";

const MAX_HISTORY = 5;

export interface AgentResult {
  reply: string;
  history: Anthropic.MessageParam[];
}

/**
 * Claude agent that can autonomously control Homey Pro devices.
 *
 * Uses Claude's tool-use to decide which Homey API calls to make
 * based on natural language instructions.
 */
export class HomeyAgent {
  private anthropic: Anthropic;
  private homey: HomeyClient;
  private model: string;

  constructor(homey: HomeyClient, apiKey: string, model = "claude-sonnet-4-6") {
    this.anthropic = new Anthropic({ apiKey });
    this.homey = homey;
    this.model = model;
  }

  /**
   * Send a natural language instruction to the agent.
   * Accepts previous conversation history for multi-turn context.
   * Returns the reply text and updated history (trimmed to MAX_HISTORY user/assistant pairs).
   */
  async run(
    userMessage: string,
    history: Anthropic.MessageParam[] = []
  ): Promise<AgentResult> {
    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: "user", content: userMessage },
    ];

    // Agentic loop: keep going until Claude stops using tools
    while (true) {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 4096,
        system:
          "You are a smart home assistant that controls a Homey Pro system. " +
          "Use the available tools to interact with devices, zones, and flows. " +
          "Be concise and helpful.",
        tools: homeyTools,
        messages,
      });

      // Collect tool results and text
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      const textParts: string[] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          const result = await executeHomeyTool(
            this.homey,
            block.name,
            block.input as Record<string, unknown>
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      // If no tools were called, we're done
      if (toolResults.length === 0) {
        const reply = textParts.join("\n");

        // Build final history: keep only user/assistant text pairs (skip tool messages)
        const trimmed = trimHistory(messages, response.content, MAX_HISTORY);

        return { reply, history: trimmed };
      }

      // Add assistant response and tool results, then loop
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    }
  }
}

/**
 * Keep only the last N user/assistant text pairs from the conversation.
 * Tool-use messages are internal to a single turn and not preserved.
 */
function trimHistory(
  messages: Anthropic.MessageParam[],
  finalContent: Anthropic.ContentBlock[],
  maxPairs: number
): Anthropic.MessageParam[] {
  // Build pairs: each user text message + the following assistant text response
  const pairs: { user: Anthropic.MessageParam; assistant: Anthropic.MessageParam }[] = [];

  // Extract user text messages and pair with next assistant text
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user" && typeof msg.content === "string") {
      // Find the final assistant response for this user message
      // It could be several messages later due to tool use loops
      pairs.push({
        user: msg,
        assistant: { role: "assistant", content: "" },
      });
    }
  }

  // Set the last pair's assistant response to the final text
  const finalText = finalContent
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  if (pairs.length > 0) {
    pairs[pairs.length - 1].assistant = {
      role: "assistant",
      content: finalText,
    };
  }

  // Also set assistant responses for earlier pairs from messages array
  for (let p = 0; p < pairs.length - 1; p++) {
    // Find the user message index
    const userIdx = messages.indexOf(pairs[p].user);
    // Walk forward to find the last assistant text before next user text
    for (let j = userIdx + 1; j < messages.length; j++) {
      const m = messages[j];
      if (m.role === "user" && typeof m.content === "string") break;
      if (m.role === "assistant") {
        const content = Array.isArray(m.content) ? m.content : [];
        const texts = content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        if (texts) {
          pairs[p].assistant = { role: "assistant", content: texts };
        }
      }
    }
  }

  // Keep only the last N pairs
  const kept = pairs.slice(-maxPairs);
  const result: Anthropic.MessageParam[] = [];
  for (const pair of kept) {
    result.push(pair.user);
    result.push(pair.assistant);
  }

  return result;
}
