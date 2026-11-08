import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

test("chat streams through the real provider SDK, persists history, retries and isolates owners", async () => {
  const root = path.resolve(".qa", "chat-" + randomUUID());
  await mkdir(root, { recursive: true });
  const original = { ...process.env },
    originalFetch = globalThis.fetch;
  process.env.DATABASE_URL =
    "file:" + path.join(root, "test.db").replaceAll("\\", "/");
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.MEROVA_LOCAL_MODEL;
  process.env.BUILDER_ACCESS_TOKEN = "test-private-invitation";
  await writeFile(path.join(root, "test.db"), "");
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
    { stdio: "pipe" },
  );
  const { db } = await import("../src/lib/db");
  const { authenticate } = await import("../src/lib/account");
  const { POST } = await import("../src/app/api/chat/route");
  const { GET, PATCH, DELETE } = await import(
    "../src/app/api/conversations/route"
  );
  const { GET: models } = await import("../src/app/api/chat/models/route");
  const base = "http://localhost:3000";
  const request = (
    route: string,
    cookie = "",
    body?: object,
    headers: Record<string, string> = {},
  ) =>
    new Request(base + route, {
      method: body ? "POST" : "GET",
      headers: {
        host: "localhost:3000",
        origin: base,
        cookie,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const stream = (events: object[]) =>
    new Response(
      events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join(""),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  let captured: Record<string, unknown> = {},
    fail = false;
  globalThis.fetch = (async (
    url: string | URL | Request,
    options?: RequestInit,
  ) => {
    const target = String(url);
    if (target.startsWith("https://api.openai.com/")) {
      if (target.endsWith("/models"))
        return Response.json({
          object: "list",
          data: [{ id: "gpt-5.4-mini" }, { id: "text-embedding-3-small" }],
        });
      captured = JSON.parse(String(options?.body));
      if (fail)
        return Response.json(
          { error: { message: "private provider details must not leak" } },
          { status: 429 },
        );
      return stream([
        { type: "response.output_text.delta", delta: "Hello **world**." },
        {
          type: "response.completed",
          response: { id: "fixture", status: "completed" },
        },
      ]);
    }
    return originalFetch(url, options);
  }) as typeof fetch;
  const key = {
    "x-forge-provider": "openai",
    "x-forge-openai-key": "sk-test-only-not-a-real-api-key",
  };
  try {
    const signup = await authenticate(
      request("/auth", "", {
        email: "chat@example.test",
        password: "Secret!2026",
        invite: process.env.BUILDER_ACCESS_TOKEN,
      }),
      true,
    );
    assert.equal(signup.status, 201);
    const cookie = signup.headers.get("set-cookie")!.split(";")[0];
    const second = await authenticate(
      request("/auth", "", {
        email: "other@example.test",
        password: "Secret!2026",
        invite: process.env.BUILDER_ACCESS_TOKEN,
      }),
      true,
    );
    const other = second.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await GET(request("/api/conversations"))).status, 401);
    assert.equal(
      (
        await POST(
          request("/api/chat", cookie, {
            requestId: randomUUID(),
            message: "No provider",
          }),
        )
      ).status,
      400,
    );
    assert.equal(await db.conversation.count(), 0);
    const found = await models(
      request("/api/chat/models", cookie, undefined, key),
    );
    assert.deepEqual((await found.json()).models, [
      { id: "gpt-5.4-mini", name: "gpt-5.4-mini" },
    ]);
    const requestId = randomUUID();
    const response = await POST(
      request("/api/chat", cookie, { requestId, message: "Hello" }, key),
    );
    assert.equal(response.status, 200);
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(events.at(-1).status, "complete");
    assert.equal(captured.store, false);
    assert.equal(captured.stream, true);
    assert.deepEqual(captured.input, [{ role: "user", content: "Hello" }]);
    const id = events[0].conversation.id;
    assert.equal(
      (await GET(request("/api/conversations?id=" + id, other))).status,
      404,
    );
    assert.equal(
      (
        await POST(
          request(
            "/api/chat",
            other,
            { conversationId: id, requestId: randomUUID(), message: "Steal" },
            key,
          ),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await POST(
          request(
            "/api/chat",
            cookie,
            { conversationId: id, requestId, message: "Duplicate" },
            key,
          ),
        )
      ).status,
      409,
    );
    const saved = (
      await (await GET(request("/api/conversations?id=" + id, cookie))).json()
    ).conversation;
    assert.equal(saved.messages[1].content, "Hello **world**.");
    fail = true;
    const failed = await POST(
      request(
        "/api/chat",
        cookie,
        {
          conversationId: id,
          requestId: randomUUID(),
          message: "Remember the last answer",
        },
        key,
      ),
    );
    const failedEvents = (await failed.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(failedEvents.at(-1).status, "error");
    assert.match(failedEvents.at(-1).error, /credit limit/);
    assert.doesNotMatch(
      JSON.stringify(failedEvents),
      /private provider details/,
    );
    assert.equal((captured.input as unknown[]).length, 3);
    fail = false;
    const retry = await POST(
      request(
        "/api/chat",
        cookie,
        {
          conversationId: id,
          requestId: randomUUID(),
          retryId: failedEvents.at(-1).id,
        },
        key,
      ),
    );
    assert.match(await retry.text(), /"status":"complete"/);
    assert.equal(
      await db.chatMessage.count({ where: { conversationId: id } }),
      4,
    );
    assert.equal(
      (
        await PATCH(
          request("/api/conversations", other, { id, title: "Wrong owner" }),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await PATCH(
          request("/api/conversations", cookie, {
            id,
            title: "Saved conversation",
          }),
        )
      ).status,
      200,
    );
    const search = await GET(request("/api/conversations?q=Saved", cookie));
    assert.equal(
      (await search.json()).conversations[0].title,
      "Saved conversation",
    );
    await db.conversation.update({
      where: { id },
      data: { lease: "running", leaseUntil: new Date(Date.now() + 60000) },
    });
    assert.equal(
      (
        await POST(
          request(
            "/api/chat",
            cookie,
            {
              conversationId: id,
              requestId: randomUUID(),
              message: "Concurrent",
            },
            key,
          ),
        )
      ).status,
      409,
    );
    assert.equal(
      (await DELETE(request("/api/conversations", cookie, { id }))).status,
      409,
    );
    await db.conversation.update({
      where: { id },
      data: { leaseUntil: new Date(0) },
    });
    await db.chatMessage.update({
      where: { id: saved.messages[1].id },
      data: { status: "streaming" },
    });
    const recovered = (
      await (await GET(request("/api/conversations?id=" + id, cookie))).json()
    ).conversation;
    assert.equal(recovered.messages[1].status, "interrupted");
    assert.equal(
      (await DELETE(request("/api/conversations", other, { id }))).status,
      409,
    );
    assert.equal(
      (await DELETE(request("/api/conversations", cookie, { id }))).status,
      200,
    );
    assert.equal(await db.chatMessage.count(), 0);
    const cross = request(
      "/api/chat",
      cookie,
      { message: "test", requestId: randomUUID() },
      key,
    );
    cross.headers.set("origin", "https://evil.invalid");
    assert.equal((await POST(cross)).status, 403);
  } finally {
    globalThis.fetch = originalFetch;
    await db.$disconnect();
    for (const name of Object.keys(process.env))
      if (!(name in original)) delete process.env[name];
    Object.assign(process.env, original);
    await rm(root, { recursive: true, force: true });
  }
});
