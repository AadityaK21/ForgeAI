import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
import { hostedConfig, prepareHosted } from "../scripts/start-hosted.mjs";
import { containedFile, instantProject } from "../src/lib/instant-paths";

function environment(directory: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FORGE_DATA_DIR: directory,
    DATABASE_URL: "file:" + path.join(directory, "workspace.db").replaceAll("\\", "/"),
    BUILDER_ACCESS_TOKEN: "disposable-hosted-test-invitation-2026",
    FORGE_PUBLIC_ORIGIN: "https://forge.example.test",
    PORT: "3100",
  };
}

test("hosted startup requires persistent paths, a private invitation and a valid origin", () => {
  const root = path.join(tmpdir(), "forge-config-test");
  const env = environment(root);
  assert.equal(hostedConfig(env).port, "3100");
  assert.throws(() => hostedConfig({ ...env, FORGE_DATA_DIR: "relative" }), /absolute/);
  assert.throws(() => hostedConfig({ ...env, BUILDER_ACCESS_TOKEN: "" }), /invitation/);
  assert.throws(() => hostedConfig({ ...env, PORT: "70000" }), /PORT/);
  assert.throws(() => hostedConfig({ ...env, FORGE_PUBLIC_ORIGIN: "http://forge.example.test" }), /HTTPS/);
  assert.throws(() => hostedConfig({ ...env, FORGE_PUBLIC_ORIGIN: "https://forge.example.test/app" }), /HTTPS/);
  assert.throws(() => hostedConfig({ ...env, DATABASE_URL: "file:" + path.join(root, "../outside.db") }), /inside/);
  assert.throws(() => hostedConfig({ ...env, DATABASE_URL: "file:./dev.db" }), /absolute/);
  const render = { ...env, FORGE_PUBLIC_ORIGIN: "", RENDER_EXTERNAL_URL: "https://forge-example.onrender.com" };
  assert.equal(hostedConfig(render).origin, render.RENDER_EXTERNAL_URL);
});

test("hosted migrations and project files preserve data across repeated startup", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "forge-hosted-"));
  const prior = process.env.FORGE_DATA_DIR;
  let db: PrismaClient | undefined;
  try {
    const env = await prepareHosted(environment(root));
    const migrate = () => execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, stdio: "pipe" });
    migrate();
    db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
    const owner = await db.user.create({ data: { email: "hosted@example.test", passwordHash: "test-fixture" } });
    const project = await db.project.create({ data: { title: "Persisted project", ownerId: owner.id } });
    process.env.FORGE_DATA_DIR = env.FORGE_DATA_DIR;
    const directory = await instantProject(project.id);
    assert.equal(directory, path.join(env.FORGE_DATA_DIR, "projects", project.id));
    const source = await containedFile(directory, "src/App.tsx");
    await writeFile(source, "export default function App(){return <main>Persistent</main>}");
    await assert.rejects(instantProject("../escape"));
    await assert.rejects(containedFile(directory, "../escape.tsx"));
    await db.$disconnect();
    await prepareHosted(environment(root));
    migrate();
    db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
    assert.equal((await db.user.findUnique({ where: { id: owner.id } }))?.email, "hosted@example.test");
    assert.equal((await db.project.findUnique({ where: { id: project.id } }))?.title, "Persisted project");
    assert.match(await readFile(await containedFile(await instantProject(project.id), "src/App.tsx"), "utf8"), /Persistent/);
  } finally {
    await db?.$disconnect();
    if (prior === undefined) delete process.env.FORGE_DATA_DIR;
    else process.env.FORGE_DATA_DIR = prior;
    // root is exclusively the random directory created for this test.
    await rm(root, { recursive: true, force: true });
  }
});
