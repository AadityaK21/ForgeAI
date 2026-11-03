import test from "node:test";
import assert from "node:assert/strict";
import { buildApp, type Event, type Worker } from "../src/lib/engine";
const initial = { files: {}, install: "", start: "" };
const full =
  '<artifact id="create" title="Notes"><action type="file" filePath="package.json">{}</action><action type="file" filePath="tsconfig.json">{}</action><action type="file" filePath="src/app/page.tsx">broken</action><action type="shell">npm install</action><action type="start">npm run dev</action></artifact>';
const patch =
  '<artifact id="repair" title="Fix type"><action type="file" filePath="src/app/page.tsx">correct</action></artifact>';
test("passes the compiler diagnostic and current files to a targeted repair", async () => {
  const files: Record<string, string> = {},
    events: Event[] = [],
    commands: string[] = [];
  const worker: Worker = {
    async write(p, c) {
      files[p] = c;
    },
    async run(c) {
      commands.push(c);
      if (c.includes("tsc") && files["src/app/page.tsx"] === "broken")
        throw Error("page.tsx(1): TS2322 string cannot be assigned to number");
    },
    async start() {
      commands.push("started");
    },
    async stop() {},
  };
  const result = await buildApp(
    initial,
    "Make notes",
    async function* (s) {
      if (s.attempt) {
        assert.match(s.diagnostic, /TS2322/);
        assert.equal(s.files["src/app/page.tsx"], "broken");
      }
      for (const ch of s.attempt ? patch : full) yield ch;
    },
    worker,
    (e) => events.push(e),
    new AbortController().signal,
  );
  assert.equal(result.files["src/app/page.tsx"], "correct");
  assert.equal(result.start, "npm run dev");
  assert.equal(events.filter((e) => e.type === "repair").length, 1);
  assert.equal(commands.at(-1), "started");
});
test("allows exactly three repairs on a persistent error and never launches an invalid project", async () => {
  let calls = 0,
    started = false;
  await assert.rejects(
    buildApp(
      initial,
      "Build notes",
      async function* () {
        calls++;
        yield calls === 1 ? full : patch;
      },
      {
        async write() {},
        async stop() {},
        async run(c) {
          if (c.includes("tsc")) throw Error("TS1005");
        },
        async start() {
          started = true;
        },
      },
      () => {},
      new AbortController().signal,
    ),
    /after three repairs/,
  );
  assert.equal(calls, 4);
  assert.equal(started, false);
});
