import { test } from "node:test";
import assert from "node:assert/strict";
import { agentConfig, modelSession } from "../src/lib/agent/provider";
import { runAgent } from "../src/lib/agent/loop";

test("native Anthropic stream carries tool results and usage through the agent loop", async () => {
  const original = { ...process.env },
    originalFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "sk-ant-fixture-not-real";
  process.env.AGENT_MODEL_BUDGETS = JSON.stringify({
    "claude-sonnet-4-6": { input: 3, output: 15, context: 32000 },
  });
  let calls = 0;
  globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    const observed = calls++ > 0;
    if (observed)
      assert.match(JSON.stringify(body.messages.at(-1)), /tool_result.*60/);
    const events = [
      {
        type: "message_start",
        message: {
          id: "msg",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [],
          stop_reason: null,
          usage: { input_tokens: 100, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: observed
          ? { type: "text", text: "" }
          : { type: "tool_use", id: "calc", name: "calculator", input: {} },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: observed
          ? { type: "text_delta", text: "The result is 60." }
          : {
              type: "input_json_delta",
              partial_json: '{"expression":"(12+3)*4"}',
            },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: {
          stop_reason: observed ? "end_turn" : "tool_use",
          stop_sequence: null,
        },
        usage: { output_tokens: 20 },
      },
      { type: "message_stop" },
    ];
    return new Response(
      events
        .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
        .join(""),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }) as typeof fetch;
  try {
    const settings = agentConfig(
      new Request("https://example.com/api/chat", {
        headers: { "x-forge-provider": "anthropic" },
      }),
    );
    const result = await runAgent({
      session: modelSession(settings, [
        { role: "user", content: "Calculate (12+3)*4" },
      ]),
      limits: settings.limits,
      signal: new AbortController().signal,
      emit() {},
      async save() {},
    });
    assert.equal(result.reason, "done");
    assert.equal(calls, 2);
    assert.equal(result.tokens, 240);
    assert.equal(result.text.trim(), "The result is 60.");
    calls = 0;
    const originalSession = modelSession(settings, [
      { role: "user", content: "Calculate (12+3)*4" },
    ]);
    const pending = await originalSession.next(
      256,
      new AbortController().signal,
      () => {},
    );
    const restoredSession = modelSession(
      settings,
      [],
      originalSession.snapshot!(),
    );
    restoredSession.observe(
      pending.calls[0],
      "<untrusted_tool_data>60</untrusted_tool_data>",
    );
    const continued = await restoredSession.next(
      256,
      new AbortController().signal,
      () => {},
    );
    assert.equal(continued.text, "The result is 60.");
    assert.equal(calls, 2, "Anthropic transcript resumes a saved native call");
    delete process.env.ANTHROPIC_API_KEY;
    assert.throws(
      () =>
        agentConfig(
          new Request("https://example.com/api/chat", {
            headers: {
              "x-forge-provider": "anthropic",
              "x-forge-anthropic-key": "sk-ant-personal-key-not-accepted",
            },
          }),
        ),
      /configured on the server/,
    );
  } finally {
    process.env = original;
    globalThis.fetch = originalFetch;
  }
});
