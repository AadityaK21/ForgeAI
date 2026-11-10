import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { chatText, providerError } from "../src/lib/chat-provider";
import { requestProviders } from "../src/lib/providers";

test("OpenAI streaming failures preserve categories without exposing provider details", async () => {
  const originalFetch = globalThis.fetch;
  const config = requestProviders(new Request("https://merova-test.example", {
    headers: { "x-forge-provider": "openai", "x-forge-openai-key": "sk-test-only-not-a-real-api-key" },
  }));
  try {
    for (const type of ["error", "response.failed"]) {
      for (const [code, expected] of [
        ["server_error", /temporarily unavailable/],
        ["model_not_found", /cannot access/],
        ["rate_limit_exceeded", /rate limiting/],
        ["insufficient_quota", /insufficient API quota/],
        ["unsupported_parameter", /request format/],
        ["unknown-secret-code", /unrecognized error/],
      ] as const) {
        const error = { code, message: "private prompt and secret must not leak" };
        const event = type === "error" ? { type, ...error } : { type, response: { error, status: "failed" } };
        globalThis.fetch = async () => new Response(
          `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
        let caught: unknown;
        try {
          for await (const chunk of chatText(config, "gpt-6.1-sol", [{ role: "user", content: "Hello" }], new AbortController().signal)) void chunk;
        } catch (error) { caught = error; }
        assert.ok(caught instanceof OpenAI.APIError);
        assert.match(providerError(caught), expected);
        assert.doesNotMatch(providerError(caught), /private prompt|secret/);
      }
    }
  } finally { globalThis.fetch = originalFetch; }
});
