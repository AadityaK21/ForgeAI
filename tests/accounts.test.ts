import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

test("accounts isolate projects, revoke signed-out sessions and enforce private invitations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "forge-account-test-"));
  const database = path.join(directory, "accounts.db");
  const priorUrl = process.env.DATABASE_URL,
    priorInvite = process.env.BUILDER_ACCESS_TOKEN;
  process.env.DATABASE_URL = "file:" + database.replaceAll("\\", "/");
  process.env.BUILDER_ACCESS_TOKEN = "testing-private-invitation";
  await writeFile(database, "");
  const { db } = await import("../src/lib/db");
  try {
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
      { stdio: "pipe" },
    );
    const { authenticate } = await import("../src/lib/account");
    const { GET: projects } = await import("../src/app/api/projects/route");
    const { POST: signout } =
      await import("../src/app/api/auth/sign-out/route");
    const { GET: session } = await import("../src/app/api/auth/session/route");
    const post = (data: object, cookie = "") =>
      new Request("http://localhost:3000/api/auth", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          host: "localhost:3000",
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify(data),
      });
    const get = (cookie = "", id = "") =>
      new Request(
        "http://localhost:3000/api/projects" + (id ? "?id=" + id : ""),
        { headers: { host: "localhost:3000", cookie } },
      );
    const credentials = {
      email: "first@example.test",
      password: "Project!2026",
      invite: process.env.BUILDER_ACCESS_TOKEN,
    };
    assert.equal((await projects(get())).status, 401);
    assert.equal(
      (await authenticate(post({ ...credentials, invite: "invalid" }), true))
        .status,
      403,
    );
    assert.equal(
      (await authenticate(post({ ...credentials, password: "short" }), true))
        .status,
      400,
    );
    const register = await authenticate(post(credentials), true);
    assert.equal(register.status, 201);
    const fullCookie = register.headers.get("set-cookie")!;
    assert.match(fullCookie, /HttpOnly/);
    assert.match(fullCookie, /SameSite=Lax/);
    const cookie = fullCookie.split(";")[0];
    const principal = (await (await session(get(cookie))).json()).user;
    assert.equal(principal.email, credentials.email);
    const project = await db.project.create({ data: { title: "Legacy project", ownerId: principal.id } });
    assert.equal((await projects(get(cookie, project.id))).status, 200);
    const second = await authenticate(
      post({ ...credentials, email: "second@example.test" }),
      true,
    );
    assert.equal(second.status, 201);
    assert.equal(
      (
        await projects(
          get(second.headers.get("set-cookie")!.split(";")[0], project.id),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await authenticate(
          post({ ...credentials, password: "incorrect" }),
          false,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await authenticate(
          post({ ...credentials, email: "FIRST@example.test" }),
          false,
        )
      ).status,
      200,
    );
    assert.equal((await signout(post({}, cookie))).status, 200);
    assert.equal((await projects(get(cookie))).status, 401);
    const crossSite = post(credentials);
    crossSite.headers.set("origin", "https://elsewhere.invalid");
    assert.equal((await authenticate(crossSite, true)).status, 403);
  } finally {
    await db.$disconnect();
    if (priorUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorUrl;
    if (priorInvite === undefined) delete process.env.BUILDER_ACCESS_TOKEN;
    else process.env.BUILDER_ACCESS_TOKEN = priorInvite;
    await rm(directory, { recursive: true, force: true });
  }
});
