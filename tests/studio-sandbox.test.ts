import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";

test("owned revisions support live data, validated manual saves and export", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forge-studio-test-"));
  const dbfile = path.join(root, "studio.db");
  await writeFile(dbfile, "");
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "file:" + dbfile.replaceAll("\\", "/");
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
    { stdio: "pipe" },
  );
  const { db } = await import("../src/lib/db");
  const { digest, cookieName } = await import("../src/lib/access");
  const { GET, PUT, POST } = await import("../src/app/api/sandbox/route");
  const { GET: zip } = await import("../src/app/api/sandbox/export/route");
  const inspector = await import("../src/app/api/sandbox/inspect/route");
  const { createInstantWorker } = await import("../src/lib/instant-worker");
  const { instantStarter } = await import("../src/lib/instant-starter");
  const id = "studio-test-" + randomUUID();
  const dbPath = path.resolve(".sandboxes", id);
  try {
    const connected = await db.$queryRawUnsafe<{ file: string }[]>(
      "PRAGMA database_list",
    );
    assert.equal(path.resolve(connected[0].file), path.resolve(dbfile));
    const { id: ownerId } = await db.user.create({
      data: { email: "owner@example.test", passwordHash: "test-fixture" },
    });
    const { id: otherId } = await db.user.create({
      data: { email: "other@example.test", passwordHash: "test-fixture" },
    });
    async function cookieFor(userId: string) {
      const value = randomBytes(32).toString("base64url");
      await db.session.create({
        data: {
          userId,
          digest: digest(value),
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      return cookieName + "=" + value;
    }
    const cookie = await cookieFor(ownerId),
      other = await cookieFor(otherId);
    function request(
      method: string,
      url: string,
      payload?: unknown,
      auth = cookie,
    ) {
      return new Request("http://localhost:3000" + url, {
        method,
        headers: {
          cookie: auth,
          origin: "http://localhost:3000",
          host: "localhost:3000",
          "content-type": "application/json",
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
    }
    const setup = instantStarter({ files: {}, install: "", start: "" });
    setup.files["forge.schema.json"] = JSON.stringify({
      tables: { leads: { fields: { name: "string" }, seed: [] } },
    });
    setup.files["src/App.tsx"] =
      "export default function App({path}:{path:string}){return <h1>First revision</h1>;}";
    const initial = await createInstantWorker(
      id,
      () => {},
      new AbortController().signal,
    );
    for (const [name, content] of Object.entries(setup.files))
      await initial.worker.write(name, content);
    await initial.worker.start("forge preview");
    await initial.release(true);
    await db.project.create({
      data: {
        id,
        title: "Leads",
        ownerId,
        revision: 1,
        sandboxId: initial.id,
        preview: initial.url,
        install: setup.install,
        start: setup.start,
        files: {
          create: Object.entries(setup.files).map(([path, content]) => ({
            path,
            content,
          })),
        },
      },
    });
    const url = "/api/sandbox?projectId=" + id,
      edits = {
        projectId: id,
        revision: 1,
        path: "src/App.tsx",
        content:
          "export default function App({path}:{path:string}){return <h1>Edited from the studio</h1>;}",
      };
    assert.equal((await GET(request("GET", url, undefined, ""))).status, 401);
    assert.equal(
      (await GET(request("GET", url, undefined, other))).status,
      404,
    );
    assert.equal((await PUT(request("PUT", url, edits, other))).status, 404);
    assert.equal(
      (await zip(request("GET", url, undefined, other))).status,
      404,
    );
    assert.equal(
      (await inspector.GET(request("GET", url, undefined, other))).status,
      404,
    );
    assert.equal(
      (await PUT(request("PUT", url, { ...edits, revision: 0 }))).status,
      409,
    );
    assert.equal(
      (await PUT(request("PUT", url, { ...edits, path: "../.env" }))).status,
      400,
    );
    const protectedEdit = await PUT(
      request("PUT", url, { ...edits, path: "runtime/main.tsx" }),
    );
    assert.equal(protectedEdit.status, 422);
    // A newer studio release may refresh a portable runtime between revisions.
    await db.sourceFile.update({
      where: { projectId_path: { projectId: id, path: "runtime/main.tsx" } },
      data: {
        content:
          setup.files["runtime/main.tsx"] + "\n// previous runtime version",
      },
    });
    const invalid = await PUT(
      request("PUT", url, {
        ...edits,
        content:
          "export default function App({path}:{path:string}){return <h1>Oops</div>}",
      }),
    );
    assert.equal(invalid.status, 422, await invalid.text());
    let project = await (await GET(request("GET", url))).json();
    assert.equal(project.revision, 1);
    assert.equal(project.sandboxId, initial.id);
    assert.equal(project.files[edits.path], setup.files[edits.path]);
    const save = await PUT(request("PUT", url, edits));
    const saved = await save.json();
    assert.equal(save.status, 200, JSON.stringify(saved));
    assert.equal(saved.revision, 2);
    project = await (await GET(request("GET", url))).json();
    assert.equal(project.revision, 2);
    assert.equal(project.files[edits.path], edits.content);
    assert.equal(
      project.files["runtime/main.tsx"],
      setup.files["runtime/main.tsx"],
    );
    assert.match(project.previewHtml, /Edited from the studio/);
    const file = await (
      await GET(request("GET", url + "&path=src%2FApp.tsx"))
    ).json();
    assert.equal(file.content, edits.content);
    const archive = await JSZip.loadAsync(
      await (await zip(request("GET", url))).arrayBuffer(),
    );
    assert.equal(
      await archive.file(edits.path)?.async("string"),
      edits.content,
    );
    const routes = await (await inspector.GET(request("GET", url))).json();
    assert.deepEqual(routes.tables, ["leads"]);
    assert(
      routes.routes.some((r: { path: string }) => r.path === "/api/data/leads"),
    );
    const post = await inspector.POST(
      request("POST", url, {
        projectId: id,
        path: "/api/data/leads",
        method: "POST",
        body: JSON.stringify({ name: "Visitor" }),
      }),
    );
    assert.equal((await post.json()).status, 201);
    const table = await (
      await inspector.GET(request("GET", url + "&table=leads"))
    ).json();
    assert.equal(table.rows[0].name, "Visitor");
    assert.equal(
      (await POST(request("POST", url, { prompt: "no" }))).status,
      400,
    );
  } finally {
    await db.$disconnect();
    await rm(root, { recursive: true, force: true });
    if (
      path.dirname(dbPath) === path.resolve(".sandboxes") &&
      path.basename(dbPath) === id
    )
      await rm(dbPath, { recursive: true, force: true });
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("API explorer permits only declared in-project methods and routes", async () => {
  const { appRoutes, checkProbe } = await import("../src/lib/project-api");
  const routes = appRoutes(
    {
      "src/app/api/members/[id]/route.ts":
        "export async function GET(){} export const PATCH = async () => {};",
    },
    false,
  );
  assert.deepEqual(routes, [
    { path: "/api/members/[id]", methods: ["GET", "PATCH"] },
  ]);
  checkProbe(routes, "GET", "/api/members/123?select=name");
  for (const invalid of [
    "http://127.0.0.1:3000/api/members/123",
    "//other.test/api/members/123",
    "/api/members/../api/auth",
    "/api/members/%2e%2e",
    "/api/private/1",
  ])
    assert.throws(() => checkProbe(routes, "GET", invalid));
  assert.throws(() => checkProbe(routes, "DELETE", "/api/members/123"));
});

test(
  "live Docker inspection stays in the project's worker",
  { skip: process.env.FORGE_DOCKER_TEST !== "1" },
  async () => {
    const { createDockerWorker } = await import("../src/lib/docker-worker");
    const { inspectWorker } = await import("../src/lib/sandbox-inspection");
    const id = "probe-test-" + randomUUID(),
      request = new Request("http://localhost:3000/api/sandbox/inspect", {
        headers: { host: "localhost:3000" },
      });
    const box = await createDockerWorker(
      id,
      () => {},
      AbortSignal.timeout(180000),
    );
    const project = { id, sandboxId: box.id };
    try {
      await box.worker.write("reply.txt", "before");
      await box.worker.write(
        "server.js",
        'require("node:http").createServer((req,res)=>res.end(require("node:fs").readFileSync("reply.txt"))).listen(3000,"0.0.0.0");',
      );
      await box.worker.start("node server.js");
      await inspectWorker(
        project,
        { type: "write", path: "reply.txt", content: "after" },
        request,
      );
      const found = await inspectWorker(
        project,
        { type: "api", path: "/api/example", method: "GET" },
        request,
      );
      assert.equal(found.status, 200);
      assert.equal(found.body, "after");
      await assert.rejects(
        inspectWorker(
          project,
          {
            type: "api",
            path: "https://example.invalid/api/example",
            method: "GET",
          },
          request,
        ),
        /Invalid application route/,
      );
    } finally {
      await box.release(false);
    }
  },
);
