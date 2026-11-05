import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { migrateTurso } from "../scripts/migrate-turso.mjs";

test("libSQL accounts, previews and records survive deleting the build cache", async () => {
  // Native libSQL may retain a Windows file handle until process exit. Run the
  // fixture in its own process, then remove only its exclusively created root.
  if (!process.env.FORGE_REMOTE_TEST_DIR) {
    const root = await mkdtemp(path.join(tmpdir(), "forge-libsql-"));
    try {
      const childEnv: NodeJS.ProcessEnv = { ...process.env, FORGE_REMOTE_TEST_DIR: root };
      delete childEnv.NODE_TEST_CONTEXT;
      const output = execFileSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=spec", path.resolve("tests/remote-storage.test.ts")], {
        env: childEnv, stdio: "pipe", timeout: 120000,
      });
      assert.match(output.toString(), /tests 1/);
    } finally { await rm(root, { recursive: true, force: true }); }
    return;
  }
  const root = process.env.FORGE_REMOTE_TEST_DIR;
  const original = { ...process.env };
  process.env.TURSO_DATABASE_URL = "file:" + path.join(root, "remote.db").replaceAll("\\", "/");
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.BUILDER_ACCESS_TOKEN = "private-integration-test-invitation";
  await migrateTurso();
  const { db } = await import("../src/lib/db");
  const { authenticate } = await import("../src/lib/account");
  const { GET: projects } = await import("../src/app/api/projects/route");
  const { createInstantWorker, readInstantHtml, instantStarter } = await import("../src/lib/instant-worker");
  const { instantProject } = await import("../src/lib/instant-paths");
  const { instantDataRequest } = await import("../src/lib/instant-data");
  let cache = "";
  try {
    const credentials = { email: "remote-test@example.test", password: "RemoteTest!2026", invite: process.env.BUILDER_ACCESS_TOKEN };
    const post = () => new Request("http://localhost:3000/api/auth", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(credentials) });
    const signup = await authenticate(post(), true);
    assert.equal(signup.status, 201, await signup.clone().text());
    const cookie = signup.headers.get("set-cookie")!.split(";")[0];
    const user = (await signup.json()).user;
    const project = await db.project.findFirstOrThrow({ where: { ownerId: user.id } });
    const box = await createInstantWorker(project.id, () => {}, new AbortController().signal);
    cache = await instantProject(project.id);
    const files = instantStarter({ files: {}, install: "", start: "" }).files;
    Object.assign(files, {
      "forge.schema.json": JSON.stringify({ tables: { leads: { fields: { name: "string", active: "boolean" }, seed: [{ id: "seed", name: "First", active: true }] } } }),
      "src/App.tsx": "import {useState} from 'react'; import {Check} from 'lucide-react'; export default function App({path}:{path:string}){const [n,setN]=useState(0);return <button onClick={()=>setN(n+1)}><Check/>Persistent {n}</button>}",
    });
    for (const [name, content] of Object.entries(files)) await box.worker.write(name, content);
    await box.worker.verify();
    await db.sourceFile.create({ data: { projectId: project.id, path: "forge.schema.json", content: files["forge.schema.json"] } });
    const first = await instantDataRequest(project.id, "GET", "/api/data/leads");
    assert.equal((first.body as unknown[]).length, 1);
    assert.equal((await instantDataRequest(project.id, "POST", "/api/data/leads", { name: 9 })).status, 400);
    const created = await instantDataRequest(project.id, "POST", "/api/data/leads", { id: "saved", name: "Saved", active: true });
    assert.equal(created.status, 201);
    assert.equal((await instantDataRequest(project.id, "POST", "/api/data/leads", { id: "saved", name: "Duplicate" })).status, 409);
    await box.release(true);
    await assert.rejects(access(path.join(cache, box.id)));
    await db.$disconnect();
    await migrateTurso();
    assert.match(await readInstantHtml(project.id, box.id), /Persistent/);
    assert.equal((await authenticate(post(), false)).status, 200);
    const response = await projects(new Request("http://localhost:3000/api/projects", { headers: { host: "localhost:3000", cookie } }));
    assert.equal(response.status, 200);
    const changed = await instantDataRequest(project.id, "PATCH", "/api/data/leads/saved", { name: "Changed" });
    assert.deepEqual(changed.body, { id: "saved", name: "Changed", active: true });
    assert.equal((await instantDataRequest(project.id, "GET", "/api/data/leads/saved")).status, 200);
    const other = await db.project.create({ data: { title: "Other owner", owner: { create: { email: "other-remote@example.test", passwordHash: "fixture" } }, files: { create: { path: "forge.schema.json", content: files["forge.schema.json"] } } } });
    assert.equal((await instantDataRequest(other.id, "GET", "/api/data/leads/saved")).status, 404);
    const forbidden = await projects(new Request("http://localhost:3000/api/projects?id=" + other.id, { headers: { host: "localhost:3000", cookie } }));
    assert.equal(forbidden.status, 404);
    assert.equal((await instantDataRequest(project.id, "DELETE", "/api/data/leads/saved")).status, 200);
  } finally {
    await db.$disconnect();
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    if (cache) await rm(cache, { recursive: true, force: true });
  }
});
