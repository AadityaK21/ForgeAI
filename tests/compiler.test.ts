import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildApp } from "../src/lib/engine";
const exec = promisify(execFile);
test("repair consumes a real TypeScript compiler diagnostic", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "merova-compiler-"));
  const tsc = path.resolve("node_modules/typescript/bin/tsc");
  const file = (name: string, body: string) =>
    '<action type="file" filePath="' + name + '">' + body + "</action>";
  let runs = 0;
  try {
    await buildApp(
      { files: {}, install: "", start: "" },
      "Type-check the source",
      async function* (input) {
        const content = input.attempt
          ? "export const total:number=42;"
          : 'export const total:number="bad";';
        if (input.attempt) assert.match(input.diagnostic, /TS2322/);
        yield '<artifact id="run" title="Compiler test">' +
          (!input.attempt
            ? file("package.json", "{}") +
              file(
                "tsconfig.json",
                '{"compilerOptions":{"strict":true,"types":[]},"include":["app.ts"]}',
              )
            : "") +
          file("app.ts", content) +
          (!input.attempt
            ? '<action type="shell">npm install</action><action type="start">npm run dev</action>'
            : "") +
          "</artifact>";
      },
      {
        async write(name, content) {
          await writeFile(path.join(directory, name), content);
        },
        async run(command) {
          if (command.includes("tsc")) {
            runs++;
            try {
              await exec(process.execPath, [tsc, "--noEmit"], {
                cwd: directory,
              });
            } catch (e) {
              throw Error((e as { stdout: string }).stdout);
            }
          }
        },
        async start() {},
        async stop() {},
      },
      () => {},
      new AbortController().signal,
    );
    assert.equal(runs, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
