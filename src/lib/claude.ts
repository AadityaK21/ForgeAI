import Anthropic from "@anthropic-ai/sdk";
import { ProviderFailure } from "./engine";
import { engineerPrompt } from "./prompt";
import type { Blueprint } from "./blueprint";

export async function* generateArtifact(
  client: Anthropic,
  input: {
    request: string;
    files: Record<string, string>;
    diagnostic: string;
    attempt: number;
    blueprint?: Blueprint;
  },
  signal: AbortSignal,
) {
  try {
    const events = await client.messages.create(
      {
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        system: engineerPrompt,
        messages: [{ role: "user", content: JSON.stringify(input) }],
        max_tokens: 16000,
        stream: true,
      },
      { signal },
    );
    for await (const event of events) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  } catch (error) {
    signal.throwIfAborted();
    throw new ProviderFailure(
      "Anthropic request failed: " +
        (error instanceof Anthropic.APIError
          ? "HTTP " + error.status
          : "provider unavailable"),
    );
  }
}
