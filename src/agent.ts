import Anthropic from "@anthropic-ai/sdk";
import type { HomeyClient } from "./homey-client.js";
import { homeyTools, executeHomeyTool } from "./claude-tools.js";

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
   * Claude will decide which Homey tools to call and execute them.
   */
  async run(userMessage: string): Promise<string> {
    const messages: Anthropic.MessageParam[] = [
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
        return textParts.join("\n");
      }

      // Add assistant response and tool results, then loop
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    }
  }
}
