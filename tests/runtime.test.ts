import test from "node:test";
import assert from "node:assert/strict";
import { createDockerWorker } from "../src/lib/docker-worker";
import { buildApp } from "../src/lib/engine";
import { checkNativeForms } from "../src/lib/form-contract";
import ts from "typescript";
import { blueprintSchema } from "../src/lib/blueprint";
import { brief } from "../src/lib/validation";

test("plan-only and local execution accept only supported engine choices", () => {
  const request = {
    projectId: "one",
    revision: 0,
    prompt: "Build a visitor log.",
  };
  assert.equal(brief.parse(request).mode, "build");
  assert.equal(
    brief.parse({ ...request, mode: "plan", engine: "local" }).engine,
    "local",
  );
  assert.equal(
    brief.safeParse({ ...request, engine: "host-shell" }).success,
    false,
  );
  assert.equal(
    blueprintSchema.safeParse({
      summary: "Visitor log",
      palette: ["red"],
      typography: "system",
      tables: [],
      endpoints: [],
      pages: ["/"],
    }).success,
    false,
  );
});
test("native POST forms agree with the encoding their route accepts", () => {
  const native = ts.createSourceFile(
    "src/app/page.tsx",
    'export default function Page(){return <form action="/api/visits" method="POST"><button>Visit</button></form>}',
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const source = (reader: string) => ({
    "src/app/api/visits/route.ts":
      "export async function POST(req:Request){return Response.json(await req." +
      reader +
      "());}",
  });
  assert.throws(
    () => checkNativeForms(native, source("json")),
    /reads only JSON/,
  );
  assert.doesNotThrow(() => checkNativeForms(native, source("formData")));
});
test("a React client boundary is repaired before expensive setup", async () => {
  const page =
    "import {useState} from 'react'; export default function Page(){const [n]=useState(0); return <p>{n}</p>}";
  let setup = 0;
  const result = await buildApp(
    {
      files: { "package.json": "{}", "tsconfig.json": "{}" },
      install: "npm ci",
      start: "npm run dev",
    },
    "Make a counter page",
    async function* (input) {
      if (input.attempt)
        assert.match(input.diagnostic, /src\/app\/page.tsx calls React hooks/);
      yield '<artifact id="counter" title="Counter"><action type="file" filePath="src/app/page.tsx"><![CDATA[' +
        (input.attempt ? '"use client";\n' : "") +
        page +
        "]]></action></artifact>";
    },
    {
      async run(cmd) {
        if (cmd === "npm ci") setup++;
      },
      async stop() {},
      async write() {},
      async start() {},
    },
    () => {},
    new AbortController().signal,
  );
  assert.match(result.files["src/app/page.tsx"], /^"use client"/);
  assert.equal(setup, 1);
});
test(
  "Docker preview writes files, blocks traversal and symlink paths, and serves a working application",
  { skip: process.env.FORGE_DOCKER_TEST !== "1", timeout: 210000 },
  async () => {
    const signal = AbortSignal.timeout(200000);
    const box = await createDockerWorker("runtime-test", () => {}, signal);
    try {
      await assert.rejects(box.worker.write("../private", "bad"), /Unsafe/);
      await box.worker.run("ln -s /tmp link");
      await assert.rejects(
        box.worker.write("link/bad", "x"),
        /Unsafe directory/,
      );
      await box.worker.write(
        "app/server.js",
        "require('http').createServer((req,res)=>res.end('builder verification')).listen(3000,'0.0.0.0')",
      );
      await box.worker.run("openssl version");
      await box.worker.start("node app/server.js");
      const url = new URL(box.url);
      assert.match(url.hostname, /^local-[0-9a-f-]+\.localhost$/);
      url.hostname = "127.0.0.1";
      assert.equal(
        await (await fetch(url, { signal })).text(),
        "builder verification",
      );
    } finally {
      await box.release(false);
    }
  },
);
