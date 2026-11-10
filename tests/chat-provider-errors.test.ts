import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { chatText, providerError, providerDiagnostic, reportedProviderError } from "../src/lib/chat-provider";
import { requestProviders } from "../src/lib/providers";

test("diagnostics correlate failures without logging messages, keys or arbitrary error objects", () => {
  const error = new OpenAI.APIError(undefined, {
    code: "unsupported_value", type: "invalid_request_error",
    message: "Your organization must be verified to stream this model. private@example.com sk-secret-value",
    prompt: "private user content",
  }, undefined, new Headers({ "x-request-id": "req_fixture123" }));
  assert.match(providerError(error), /organization verification/);
  const diagnostic = providerDiagnostic(error);
  assert.equal(diagnostic.code, "unsupported_value");
  assert.equal(diagnostic.requestId, "req_fixture123");
  const original = console.error;
  const logs: string[] = [];
  console.error = (value) => logs.push(String(value));
  try {
    const text = reportedProviderError(error);
    const logged = JSON.parse(logs[0]);
    assert.ok(text.endsWith(logged.reference));
    assert.equal(logged.reason, "organization_verification_required");
    assert.doesNotMatch(text + logs.join(""), /private@|sk-secret|private user content|prompt/);
  } finally { console.error = original; }
  assert.equal(providerDiagnostic(new OpenAI.APIError(undefined, { code: "sk_secret", type: "user@example.com" }, undefined, undefined)).code, null);
});

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
        ["credit_balance_exhausted", /no API credits remaining/],
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
