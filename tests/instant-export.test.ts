import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { instantStarter } from "../src/lib/instant-starter";

test("exported source serves its UI, validates a POST and reopens the SQLite database after restart", async () => {
  const root = path.resolve(".sandboxes");
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(path.join(root, "export-test-"));
  const source = instantStarter({ files: {}, install: "", start: "" }).files;
  source["forge.schema.json"] = JSON.stringify({
    tables: {
      tasks: { fields: { title: "string", done: "boolean" }, seed: [] },
    },
  });
  source["src/App.tsx"] =
    'export default function App({path}:{path:string}){return <main className="p-4">{path}<a href="#/tasks">Tasks</a></main>}';
  try {
    for (const [file, text] of Object.entries(source)) {
      const dest = path.join(folder, file);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, text);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const child = spawn(process.execPath, ["runtime/server.cjs"], {
        cwd: folder,
        env: {
          ...process.env,
          PORT: "0",
          HOST: "127.0.0.1",
          DATABASE_FILE: path.join(folder, "check.sqlite"),
        },
        windowsHide: true,
      });
      const finished = once(child, "exit");
      let stderr = "";
      child.stderr.on("data", (c) => {
        stderr += c;
      });
      try {
        const port = await new Promise<number>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("Export failed to start: " + stderr)),
            20000,
          );
          child.stdout.on("data", (c) => {
            const hit = /listening on (\d+)/.exec(String(c));
            if (hit) {
              clearTimeout(timer);
              resolve(Number(hit[1]));
            }
          });
          child.once("error", (e) => {
            clearTimeout(timer);
            reject(e);
          });
          child.once("exit", () => {
            clearTimeout(timer);
            reject(Error(stderr));
          });
        });
        const base = "http://127.0.0.1:" + port;
        assert.equal((await fetch(base + "/app.js")).status, 200);
        if (attempt === 0) {
          const result = await fetch(base + "/api/data/tasks", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Interview a founder", done: false }),
          });
          assert.equal(result.status, 201);
        }
        const rows = await (await fetch(base + "/api/data/tasks")).json();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].title, "Interview a founder");
      } finally {
        child.kill();
        await finished;
      }
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
