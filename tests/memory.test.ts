import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

test("preference memory requires opt-in, explicit consent and ownership; validates, expires and deletes", async () => {
  const root = path.resolve(".qa", "memory-" + randomUUID());
  await mkdir(root, { recursive: true });
  const original = { ...process.env };
  process.env.DATABASE_URL =
    "file:" + path.join(root, "test.db").replaceAll("\\", "/");
  delete process.env.TURSO_DATABASE_URL;
  process.env.BUILDER_ACCESS_TOKEN = "test-private-invitation";
  await writeFile(path.join(root, "test.db"), "");
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
    { stdio: "pipe" },
  );
  const { db } = await import("../src/lib/db");
  const { digest } = await import("../src/lib/access");
  const { GET, POST, PATCH, DELETE } =
    await import("../src/app/api/memories/route");
  const { memoryTools } = await import("../src/lib/agent/memory");
  const request = (token: string, body?: object) =>
    new Request("http://localhost:3000/api/memories", {
      method: body ? "POST" : "GET",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        cookie: "forge_session=" + token,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    const user = await db.user.create({
      data: { email: "memory@example.test", passwordHash: "unused" },
    });
    const stranger = await db.user.create({
      data: {
        email: "other@example.test",
        passwordHash: "unused",
        memoryEnabled: true,
      },
    });
    const token = "a".repeat(43),
      other = "b".repeat(43);
    for (const [id, value] of [
      [user.id, token],
      [stranger.id, other],
    ])
      await db.session.create({
        data: {
          digest: digest(value),
          userId: id,
          expiresAt: new Date(Date.now() + 60000),
        },
      });
    const tool = memoryTools(user.id),
      signal = new AbortController().signal;
    assert.equal((await GET(request(""))).status, 401);
    assert.equal((await (await GET(request(token))).json()).enabled, false);
    assert.equal((await tool("recall_memory", {}, signal)).failed, true);
    const preference = { category: "tone", value: "Friendly" };
    assert.equal(
      (await POST(request(token, { preference, confirmed: true }))).status,
      409,
    );
    assert.equal((await PATCH(request(token, { enabled: true }))).status, 200);
    assert.equal((await POST(request(token, { preference }))).status, 400);
    for (const invalid of [
      { category: "health", value: "private diagnosis" },
      { category: "tone", value: "account 12345678" },
      { category: "tone", value: "English" },
      { ...preference, secret: "hidden" },
    ]) {
      assert.equal(
        (await POST(request(token, { preference: invalid, confirmed: true })))
          .status,
        400,
      );
      assert.equal((await tool("save_memory", invalid, signal)).failed, true);
    }
    assert.equal((await tool("save_memory", preference, signal)).failed, false);
    assert.equal(
      await db.preferenceMemory.count(),
      0,
      "tool only proposes, never saves",
    );
    assert.equal(
      (await POST(request(token, { preference, confirmed: true }))).status,
      200,
    );
    assert.match((await tool("recall_memory", {}, signal)).text, /Friendly/);
    assert.doesNotMatch(
      (await memoryTools(stranger.id)("recall_memory", {}, signal)).text,
      /Friendly/,
    );
    assert.equal((await (await GET(request(other))).json()).memories.length, 0);
    assert.equal(
      (
        await POST(
          request(token, {
            preference: { category: "tone", value: "Direct" },
            confirmed: true,
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      await db.preferenceMemory.count(),
      1,
      "editing replaces a category",
    );
    for (const session of [token, other]) {
      assert.equal(
        (
          await POST(
            request(session, {
              preference,
              confirmed: true,
              stepId: randomUUID(),
            }),
          )
        ).status,
        409,
        "legacy proposal route cannot bypass one-call approvals",
      );
    }
    await db.preferenceMemory.updateMany({
      where: { ownerId: user.id },
      data: { expiresAt: new Date(0) },
    });
    assert.equal(
      (await tool("recall_memory", {}, signal)).text,
      '{"preferences":[]}',
    );
    assert.equal(
      (await POST(request(token, { preference, confirmed: true }))).status,
      200,
    );
    assert.equal((await PATCH(request(token, { enabled: false }))).status, 200);
    assert.equal((await tool("recall_memory", {}, signal)).failed, true);
    assert.equal(
      (await DELETE(request(token, { category: "tone" }))).status,
      200,
    );
    assert.equal(await db.preferenceMemory.count(), 0);
    assert.equal((await PATCH(request(token, { enabled: true }))).status, 200);
    assert.equal(
      (await tool("recall_memory", {}, signal)).text,
      '{"preferences":[]}',
    );
  } finally {
    await db.$disconnect();
    process.env = original;
    await rm(root, { recursive: true, force: true });
  }
});
