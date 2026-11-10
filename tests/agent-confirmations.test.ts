import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

test("durable approvals resume once, denials adjust the model, undo is owned, budgets and audit are enforced", async () => {
  const root = path.resolve(".qa", "safety-" + randomUUID());
  await mkdir(root, { recursive: true });
  const env = { ...process.env },
    realFetch = globalThis.fetch;
  process.env.DATABASE_URL =
    "file:" + path.join(root, "test.db").replaceAll("\\", "/");
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AGENT_DISABLED;
  process.env.OPENAI_API_KEY = "sk-fixture-only";
  process.env.BUILDER_ACCESS_TOKEN = "fixture-invite";
  process.env.AGENT_MODEL_BUDGETS = JSON.stringify({
    "gpt-5.4-mini": { input: 1, output: 4, context: 32000 },
  });
  process.env.AGENT_REQUESTS_PER_MINUTE = "100";
  process.env.AGENT_RUNS_PER_DAY = "100";
  await writeFile(path.join(root, "test.db"), "");
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
    { stdio: "pipe" },
  );
  const { db } = await import("../src/lib/db");
  const { digest } = await import("../src/lib/access");
  const { POST: chat } = await import("../src/app/api/chat/route");
  const { POST: confirm, GET: confirmation } =
    await import("../src/app/api/agent/confirmations/route");
  const { POST: undo } = await import("../src/app/api/memories/undo/route");
  const { GET: audit } = await import("../src/app/api/agent/audit/route");
  const { reserveSpend, settleSpend } = await import("../src/lib/agent/usage");
  const { POST: saveSettings } = await import("../src/app/api/memories/route");
  const request = (route: string, token: string, body?: object) =>
    new Request("http://localhost:3000" + route, {
      method: body ? "POST" : "GET",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        cookie: "forge_session=" + token,
        "Content-Type": "application/json",
        "x-forge-provider": "openai",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  let calls = 0,
    repeat = false;
  const observations: string[] = [];
  globalThis.fetch = (async (
    url: string | URL | Request,
    options?: RequestInit,
  ) => {
    if (!String(url).startsWith("https://api.openai.com/"))
      return realFetch(url, options);
    calls++;
    const body = JSON.parse(String(options?.body));
    const observed = body.input.filter(
      (item: { type?: string }) => item.type === "function_call_output",
    );
    if (observed.length) observations.push(observed.at(-1).output);
    const output =
      !observed.length || repeat
        ? [
            {
              type: "function_call",
              call_id: "save-" + calls,
              name: "save_memory",
              arguments: JSON.stringify({
                category: "tone",
                value: "Friendly",
              }),
            },
          ]
        : [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: observed.at(-1).output.includes("denied")
                    ? "Understood. I will not save that preference."
                    : "Your approved preference was saved.",
                  annotations: [],
                },
              ],
            },
          ];
    return new Response(
      "data: " +
        JSON.stringify({
          type: "response.completed",
          response: {
            status: "completed",
            output,
            usage: { input_tokens: 100, output_tokens: 20 },
          },
        }) +
        "\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }) as typeof fetch;
  try {
    const user = await db.user.create({
      data: {
        email: "owner@example.test",
        passwordHash: "unused",
        memoryEnabled: true,
      },
    });
    const other = await db.user.create({
      data: {
        email: "other@example.test",
        passwordHash: "unused",
        memoryEnabled: true,
      },
    });
    const token = "a".repeat(43),
      stranger = "b".repeat(43);
    for (const [userId, value] of [
      [user.id, token],
      [other.id, stranger],
    ])
      await db.session.create({
        data: {
          digest: digest(value),
          userId,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
    async function start() {
      const response = await chat(
        request("/api/chat", token, {
          message: "Remember my preferred tone is Friendly",
          agentMode: true,
          requestId: randomUUID(),
        }),
      );
      assert.equal(response.status, 200, await response.clone().text());
      const events = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(
        events.find((e) => e.type === "final").reason,
        "needs_user_input",
      );
      const stepId = events.find((e) => e.type === "tool_call").stepId;
      const step = await db.agentStep.findUniqueOrThrow({
        where: { id: stepId },
        include: { run: true },
      });
      return {
        stepId,
        runId: step.runId,
        tokens: step.run.tokens,
        cost: step.run.cost,
      };
    }
    const first = await start();
    assert.equal(await db.preferenceMemory.count(), 0);
    assert.equal(
      (
        await confirmation(
          request("/api/agent/confirmations?id=" + first.stepId, stranger),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await confirm(
          request("/api/agent/confirmations", stranger, {
            stepId: first.stepId,
            decision: "approve",
          }),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await confirm(
          request("/api/agent/confirmations", token, {
            stepId: first.stepId,
            decision: "approve",
            input: { value: "Direct" },
          }),
        )
      ).status,
      400,
    );
    const approved = await confirm(
      request("/api/agent/confirmations", token, {
        stepId: first.stepId,
        decision: "approve",
      }),
    );
    assert.equal(approved.status, 200);
    assert.match(await approved.text(), /memory_saved/);
    const memory = await db.preferenceMemory.findFirstOrThrow();
    assert.equal(memory.value, "Friendly");
    const resumed = await db.agentRun.findUniqueOrThrow({
      where: { id: first.runId },
    });
    assert.equal(resumed.status, "done");
    assert.ok(resumed.tokens > first.tokens);
    assert.ok(resumed.cost > first.cost);
    assert.match(observations.at(-1)!, /untrusted_tool_data/);
    assert.equal(
      (
        await confirm(
          request("/api/agent/confirmations", token, {
            stepId: first.stepId,
            decision: "approve",
          }),
        )
      ).status,
      409,
    );
    const saved = await db.agentConfirmation.findUniqueOrThrow({
      where: { stepId: first.stepId },
    });
    assert.equal(
      (
        await undo(
          request("/api/memories/undo", stranger, { id: saved.undoId }),
        )
      ).status,
      409,
    );
    assert.equal(
      (await undo(request("/api/memories/undo", token, { id: saved.undoId })))
        .status,
      200,
    );
    assert.equal(await db.preferenceMemory.count(), 0);
    assert.equal(
      (await undo(request("/api/memories/undo", token, { id: saved.undoId })))
        .status,
      409,
    );

    const denied = await start();
    const deniedResponse = await confirm(
      request("/api/agent/confirmations", token, {
        stepId: denied.stepId,
        decision: "deny",
      }),
    );
    assert.equal(deniedResponse.status, 200);
    assert.match(await deniedResponse.text(), /will not save/);
    assert.equal(await db.preferenceMemory.count(), 0);
    assert.match(observations.at(-1)!, /denied/);
    assert.equal(
      (
        await confirm(
          request("/api/agent/confirmations", token, {
            stepId: denied.stepId,
            decision: "approve",
          }),
        )
      ).status,
      409,
    );

    const staged = await start();
    const checkpoint = await db.agentCheckpoint.findUniqueOrThrow({
      where: { runId: staged.runId },
    });
    const state = JSON.parse(checkpoint.state);
    state.tainted = true;
    await db.agentCheckpoint.update({
      where: { runId: staged.runId },
      data: { state: JSON.stringify(state) },
    });
    repeat = true;
    const again = await confirm(
      request("/api/agent/confirmations", token, {
        stepId: staged.stepId,
        decision: "approve",
      }),
    );
    assert.equal(again.status, 200);
    assert.match(await again.text(), /needs_user_input/);
    repeat = false;
    const newPending = await db.agentConfirmation.findFirstOrThrow({
      where: { status: "pending", step: { runId: staged.runId } },
    });
    assert.equal(newPending.tainted, true);
    assert.notEqual(newPending.stepId, staged.stepId);
    assert.equal(
      await db.preferenceMemory.count(),
      1,
      "second write did not reuse approval",
    );
    const undoBeforeEdit = await db.agentConfirmation.findUniqueOrThrow({
      where: { stepId: staged.stepId },
    });
    assert.equal(
      (
        await saveSettings(
          request("/api/memories", token, {
            preference: { category: "tone", value: "Direct" },
            confirmed: true,
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await undo(
          request("/api/memories/undo", token, { id: undoBeforeEdit.undoId }),
        )
      ).status,
      409,
      "undo must not overwrite a newer preference",
    );
    await db.agentConfirmation.update({
      where: { stepId: newPending.stepId },
      data: { expiresAt: new Date(0) },
    });
    assert.equal(
      (
        await confirm(
          request("/api/agent/confirmations", token, {
            stepId: newPending.stepId,
            decision: "approve",
          }),
        )
      ).status,
      409,
    );

    assert.equal((await audit(request("/api/agent/audit", token))).status, 403);
    process.env.AGENT_ADMIN_USER_IDS = user.id;
    const logs = await (await audit(request("/api/agent/audit", token))).json();
    assert.ok(
      logs.rows.some((row: { status: string }) => row.status === "denied"),
    );
    assert.doesNotMatch(
      JSON.stringify(logs),
      /Friendly|Direct|owner@example|sk-fixture/,
    );
    assert.equal(
      (await audit(request("/api/agent/audit", stranger))).status,
      403,
    );
    const before = calls;
    process.env.AGENT_DISABLED = "true";
    assert.equal(
      (
        await chat(
          request("/api/chat", token, {
            message: "hi",
            agentMode: true,
            requestId: randomUUID(),
          }),
        )
      ).status,
      503,
    );
    assert.equal(calls, before);
    delete process.env.AGENT_DISABLED;

    process.env.AGENT_REQUESTS_PER_MINUTE = "1";
    assert.equal(
      (
        await chat(
          request("/api/chat", token, {
            message: "hi",
            agentMode: true,
            requestId: randomUUID(),
          }),
        )
      ).status,
      429,
    );
    process.env.AGENT_REQUESTS_PER_MINUTE = "100";
    process.env.AGENT_RUNS_PER_DAY = "1";
    assert.equal(
      (
        await chat(
          request("/api/chat", token, {
            message: "hi",
            agentMode: true,
            requestId: randomUUID(),
          }),
        )
      ).status,
      429,
    );
    process.env.AGENT_RUNS_PER_DAY = "100";
    process.env.AGENT_DAILY_SPEND_USD = "0.1";
    assert.equal(
      (
        await chat(
          request("/api/chat", token, {
            message: "hi",
            agentMode: true,
            requestId: randomUUID(),
          }),
        )
      ).status,
      429,
    );
    assert.equal(calls, before);

    process.env.AGENT_DAILY_SPEND_USD = "0.5";
    const date = new Date("2030-01-01T12:00:00Z");
    const message = await db.chatMessage.findFirstOrThrow({
      where: { role: "assistant" },
    });
    const r1 = await db.agentRun.create({
      data: { messageId: message.id, model: "fixture" },
    });
    const r2 = await db.agentRun.create({
      data: { messageId: message.id, model: "fixture" },
    });
    const competing = await Promise.allSettled(
      [r1, r2].map((run) =>
        db.$transaction((tx) => reserveSpend(tx, run.id, 0.5, date)),
      ),
    );
    assert.equal(
      competing.filter((value) => value.status === "fulfilled").length,
      1,
    );
    assert.equal(
      (await db.agentSpend.findUniqueOrThrow({ where: { day: "2030-01-01" } }))
        .micros,
      500000,
    );
    const reservation = await db.agentReservation.findFirstOrThrow({
      where: { day: "2030-01-01" },
    });
    await settleSpend(reservation.runId, 0.1);
    await settleSpend(reservation.runId, 0.1);
    assert.equal(
      (await db.agentSpend.findUniqueOrThrow({ where: { day: "2030-01-01" } }))
        .micros,
      100000,
      "settlement refunds once",
    );
  } finally {
    globalThis.fetch = realFetch;
    await db.$disconnect();
    process.env = env;
    await rm(root, { recursive: true, force: true });
  }
});
