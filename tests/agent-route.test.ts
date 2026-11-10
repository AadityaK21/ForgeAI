import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

test("authenticated agent stream persists steps, protects full outputs and preserves ordinary chat", async () => {
  const root = path.resolve(".qa", "agent-" + randomUUID());
  await mkdir(root, { recursive: true });
  const original = { ...process.env },
    originalFetch = globalThis.fetch;
  process.env.DATABASE_URL =
    "file:" + path.join(root, "test.db").replaceAll("\\", "/");
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test-fixture-only";
  process.env.AGENT_MODEL_BUDGETS = JSON.stringify({
    "gpt-5.4-mini": { input: 1, output: 4, context: 32000 },
  });
  process.env.BUILDER_ACCESS_TOKEN = "test-private-invitation";
  await writeFile(path.join(root, "test.db"), "");
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
    { stdio: "pipe" },
  );
  const { db } = await import("../src/lib/db");
  const { digest } = await import("../src/lib/access");
  const { POST } = await import("../src/app/api/chat/route");
  const { GET, PATCH, DELETE } = await import(
    "../src/app/api/conversations/route"
  );
  const { GET: output } = await import("../src/app/api/agent/outputs/route");
  let modelCalls = 0;
  globalThis.fetch = (async (
    url: string | URL | Request,
    options?: RequestInit,
  ) => {
    if (!String(url).startsWith("https://api.openai.com/"))
      return originalFetch(url, options);
    const body = JSON.parse(String(options?.body));
    assert.equal(body.store, false);
    modelCalls++;
    const toolResult = body.input.find(
      (item: { type: string }) => item.type === "function_call_output",
    );
    const result =
      toolResult || !body.tools
        ? {
            status: "completed",
            output: [
              {
                type: "message",
                id: "msg",
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: "The result is 60.",
                    annotations: [],
                  },
                ],
              },
            ],
            usage: { input_tokens: 100, output_tokens: 20 },
          }
        : {
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "call1",
                name: "calculator",
                arguments: '{"expression":"(12+3)*4"}',
              },
            ],
            usage: { input_tokens: 100, output_tokens: 20 },
          };
    const events = [
      ...(toolResult || !body.tools
        ? [{ type: "response.output_text.delta", delta: "The result is 60." }]
        : []),
      { type: "response.completed", response: result },
    ];
    return new Response(
      events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }) as typeof fetch;
  const request = (
    route: string,
    token: string,
    body?: object,
    method?: string,
  ) =>
    new Request("http://localhost:3000" + route, {
      method: method || (body ? "POST" : "GET"),
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        cookie: "forge_session=" + token,
        "Content-Type": "application/json",
        "x-forge-provider": "openai",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    const user = await db.user.create({
      data: { email: "agent@example.test", passwordHash: "not-used" },
    });
    const stranger = await db.user.create({
      data: { email: "stranger@example.test", passwordHash: "not-used" },
    });
    const token = "a".repeat(43),
      otherToken = "b".repeat(43);
    for (const [id, value] of [
      [user.id, token],
      [stranger.id, otherToken],
    ])
      await db.session.create({
        data: {
          digest: digest(value),
          userId: id,
          expiresAt: new Date(Date.now() + 60000),
        },
      });
    assert.equal(
      (
        await POST(
          request("/api/chat", "", {
            message: "Calculate",
            agentMode: true,
            requestId: randomUUID(),
          }),
        )
      ).status,
      401,
    );
    const response = await POST(
      request("/api/chat", token, {
        message: "Calculate (12+3)*4",
        agentMode: true,
        requestId: randomUUID(),
      }),
    );
    assert.equal(response.status, 200);
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.equal(events.at(-1).status, "complete");
    assert.equal(events.find((e) => e.type === "final").reason, "done");
    assert.equal(modelCalls, 2);
    const conversationId = events[0].conversation.id;
    const reloaded = await (
      await GET(request("/api/conversations?id=" + conversationId, token))
    ).json();
    assert.equal(reloaded.conversation.agentMode, true);
    const assistant = reloaded.conversation.messages.at(-1);
    assert.match(assistant.content, /The result is 60/);
    assert.equal(assistant.agentRuns[0].status, "done");
    const step = assistant.agentRuns[0].steps[0];
    assert.equal(step.preview, "60");
    assert.equal(
      (await output(request("/api/agent/outputs?id=" + step.id, otherToken)))
        .status,
      404,
    );
    assert.equal(
      (
        await (
          await output(request("/api/agent/outputs?id=" + step.id, token))
        ).json()
      ).content,
      "60",
    );
    assert.equal(
      (
        await PATCH(
          request(
            "/api/conversations",
            token,
            { id: conversationId, agentMode: false },
            "PATCH",
          ),
        )
      ).status,
      200,
    );
    const normal = await POST(
      request("/api/chat", token, {
        conversationId,
        message: "hello",
        requestId: randomUUID(),
      }),
    );
    assert.doesNotMatch(await normal.text(), /tool_call|tool_result/);
    const oldHistory = Array.from({ length: 20 }, (_, index) => ({
      conversationId,
      role: index % 2 ? "assistant" : "user",
      content:
        index % 2
          ? "Older explanation. ".repeat(150)
          : `Keep goal ${index} unchanged`,
      createdAt: new Date(Date.now() - 100000 + index),
    }));
    await db.chatMessage.createMany({ data: oldHistory });
    const compactResponse = await POST(
      request("/api/chat", token, {
        conversationId,
        message: "Calculate again",
        agentMode: true,
        requestId: randomUUID(),
      }),
    );
    const compactEvents = (await compactResponse.text())
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.equal(compactEvents.at(-1).status, "complete");
    const snapshot = JSON.parse(
      compactEvents[0].messages.at(-1).agentRuns[0].contextSnapshot,
    );
    assert.ok(snapshot.afterBytes < snapshot.beforeBytes);
    const restored = await (
      await GET(request("/api/conversations?id=" + conversationId, token))
    ).json();
    assert.equal(
      restored.conversation.messages.at(-1).agentRuns[0].contextSnapshot,
      JSON.stringify(snapshot),
    );
    assert.ok(
      restored.conversation.messages.some(
        (m: { content: string }) => m.content === oldHistory[1].content,
      ),
      "original long reply remains intact",
    );
    const limitKey = `agent-minute:${user.id}:${Math.floor(Date.now() / 60000)}`;
    await db.authAttempt.upsert({
      where: { key: limitKey },
      create: {
        key: limitKey,
        count: 5,
        expiresAt: new Date(Date.now() + 600000),
      },
      update: { count: 5 },
    });
    assert.equal(
      (
        await POST(
          request("/api/chat", token, {
            conversationId,
            message: "calculate",
            agentMode: true,
            requestId: randomUUID(),
          }),
        )
      ).status,
      429,
    );
    delete process.env.OPENAI_API_KEY;
    const before = modelCalls;
    assert.equal(
      (
        await POST(
          request("/api/chat", token, {
            conversationId,
            message: "calculate",
            agentMode: true,
            requestId: randomUUID(),
          }),
        )
      ).status,
      400,
    );
    assert.equal(modelCalls, before);
    assert.equal(
      (
        await DELETE(
          request(
            "/api/conversations",
            token,
            { id: conversationId },
            "DELETE",
          ),
        )
      ).status,
      200,
    );
    assert.equal(await db.agentOutput.count(), 0);
  } finally {
    globalThis.fetch = originalFetch;
    await db.$disconnect();
    process.env = original;
    await rm(root, { recursive: true, force: true });
  }
});
