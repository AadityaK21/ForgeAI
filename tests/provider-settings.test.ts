import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  requestProviders,
  canSaveKeys,
  providerStatus,
} from "../src/lib/providers";
import { saveEnvironment } from "../src/lib/server-settings";
import { openAIText } from "../src/lib/openai-model";
import { anthropicTools } from "../src/lib/agent-runner";
import { buildApp, type Worker } from "../src/lib/engine";
import { planApplication, type Blueprint } from "../src/lib/blueprint";

test("provided credentials are request-scoped and persistence is restricted to the local owner", () => {
  const key = "sk-project-test-12345",
    before = process.env.OPENAI_API_KEY,
    admin = process.env.FORGE_SETTINGS_ADMIN_ID;
  const request = (
    headers: Record<string, string> = {},
    url = "http://localhost:3000",
  ) =>
    new Request(url, {
      headers: {
        host: "localhost:3000",
        "x-forge-openai-key": key,
        ...headers,
      },
    });
  try {
    process.env.FORGE_SETTINGS_ADMIN_ID = "owner";
    const req = request(),
      settings = requestProviders(req);
    assert.equal(settings.provider, "openai");
    assert.equal(settings.openaiKey, key);
    assert.equal(process.env.OPENAI_API_KEY, before);
    assert(!JSON.stringify(providerStatus(settings, true)).includes(key));
    assert(canSaveKeys(req, "owner"));
    assert(!canSaveKeys(req, "other"));
    assert(
      !canSaveKeys(request({ "x-forwarded-for": "203.0.113.1" }), "owner"),
    );
    assert(!canSaveKeys(request({ forwarded: "for=127.0.0.1" }), "owner"));
    assert(!canSaveKeys(request({ host: "evil.test" }), "owner"));
    assert.throws(
      () => requestProviders(request({ "x-forge-openai-key": "bad=value" })),
      /format/,
    );
    assert.throws(
      () =>
        requestProviders(request({ host: "forge.test" }, "http://forge.test")),
      /HTTPS/,
    );
  } finally {
    if (admin === undefined) delete process.env.FORGE_SETTINGS_ADMIN_ID;
    else process.env.FORGE_SETTINGS_ADMIN_ID = admin;
  }
});
test("local settings persistence preserves unrelated values and rejects concurrent writers", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "forge-settings-test-"));
  const file = path.join(dir, ".env.local"),
    lock = file + ".lock";
  try {
    await writeFile(file, "OTHER=42\nOPENAI_API_KEY=old\n");
    await saveEnvironment({ OPENAI_API_KEY: "sk-disposable-test-456" }, dir);
    assert.equal(
      await readFile(file, "utf8"),
      "OTHER=42\nOPENAI_API_KEY=sk-disposable-test-456\n",
    );
    await writeFile(lock, "");
    await assert.rejects(
      saveEnvironment({ OPENAI_API_KEY: "sk-disposable-test-789" }, dir),
      /being updated/,
    );
  } finally {
    await unlink(lock).catch(() => {});
    await unlink(file).catch(() => {});
    await rmdir(dir);
  }
});
test("OpenAI sends non-stored Responses requests and requires a complete streaming response", async () => {
  let complete = true;
  const client = new OpenAI({
    apiKey: "sk-disposable-test-123",
    fetch: async (url, init) => {
      assert.equal(new URL(String(url)).pathname, "/v1/responses");
      const body = JSON.parse(String(init!.body));
      assert.equal(body.store, false);
      assert.equal(body.stream, true);
      const events = [
        { type: "response.output_text.delta", delta: "compiled source" },
        ...(complete
          ? [{ type: "response.completed", response: { status: "completed" } }]
          : []),
      ];
      return new Response(
        events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  async function run() {
    let text = "";
    for await (const part of openAIText(
      client,
      "test-model",
      "Return text",
      "build an app",
      new AbortController().signal,
    ))
      text += part;
    return text;
  }
  assert.equal(await run(), "compiled source");
  complete = false;
  await assert.rejects(run(), /before it was complete/);
});

test("Anthropic architect, writer, file inspector and verifier carry real tool results through repair", async () => {
  const plan: Blueprint = {
    summary: "Collect visitor notes",
    palette: ["#112233", "#ffffff"],
    typography: "System sans",
    tables: ["notes"],
    endpoints: ["POST /api/data/notes"],
    pages: ["/"],
  };
  const path = "src/App.tsx",
    source = "export default function App(){return null}";
  const calls = [
    ["list_project_files", {}],
    [
      "write_project_files",
      {
        phase: "backend",
        files: [{ path: "forge.schema.json", content: "{}" }],
      },
    ],
    [
      "write_project_files",
      { phase: "frontend", files: [{ path, content: source }] },
    ],
    ["inspect_file", { path }],
    ["run_build_verification", {}],
    [
      "write_project_files",
      { phase: "repair", files: [{ path, content: source + "\n" }] },
    ],
    ["run_build_verification", {}],
  ] as const;
  const files: Record<string, string> = {};
  let step = 0,
    verifications = 0;
  const client = new Anthropic({
    apiKey: "sk-ant-disposable",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (!body.stream) {
        assert.equal(body.tool_choice.name, "create_architecture_blueprint");
        return Response.json({
          id: "msg_plan",
          type: "message",
          role: "assistant",
          model: "test",
          content: [
            {
              type: "tool_use",
              id: "tool_plan",
              name: "create_architecture_blueprint",
              input: plan,
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      }
      if (step === 4)
        assert.match(JSON.stringify(body.messages.at(-1)), /function App/);
      if (step === 5)
        assert.match(
          JSON.stringify(body.messages[0]),
          /intentional compiler diagnostic/,
        );
      const [name, input] = calls[step++];
      const events = [
        {
          type: "message_start",
          message: {
            id: "msg_" + step,
            type: "message",
            role: "assistant",
            model: "test",
            content: [],
            stop_reason: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool_" + step,
            name,
            input: {},
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(input),
          },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 5 },
        },
        { type: "message_stop" },
      ];
      return new Response(
        events
          .map(
            (e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n",
          )
          .join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  const signal = new AbortController().signal;
  const blueprint = await planApplication(
    client,
    "test",
    "Create a visitor book",
    null,
    signal,
    async function* () {
      throw Error("unexpected fallback");
    },
    true,
  );
  const worker: Worker = {
    async write(path, content) {
      files[path] = content;
    },
    async read(path) {
      return files[path];
    },
    async list() {
      return Object.keys(files);
    },
    async run() {
      throw Error("unexpected shell");
    },
    async stop() {},
    async start() {},
    async verify() {
      if (++verifications === 1) throw Error("intentional compiler diagnostic");
    },
  };
  await buildApp(
    { files: {}, start: "forge preview", install: "forge verify" },
    "Create a visitor book",
    (input, s) =>
      anthropicTools(
        client,
        "test",
        input,
        blueprint,
        worker,
        "Build an app",
        () => {},
        s,
      ),
    worker,
    () => {},
    signal,
  );
  assert.equal(step, 7);
  assert.equal(verifications, 2);
  assert.equal(files[path], source + "\n");
});
