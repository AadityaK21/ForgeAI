import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate } from "../src/lib/agent/calculator";
import { publicAddress, publicUrl } from "../src/lib/agent/network";
import { execute, trimOutput } from "../src/lib/agent/tools";
import { runAgent } from "../src/lib/agent/loop";
import type {
  AgentEvent,
  Limits,
  ModelSession,
  Round,
  StoredStep,
} from "../src/lib/agent/types";
const limits: Limits = {
  steps: 12,
  milliseconds: 1000,
  tokens: 60000,
  context: 32000,
  cost: 0.5,
  inputRate: 3,
  outputRate: 15,
  searchCost: 0.01,
};
const answer: Round = {
  text: "The result is 60.",
  calls: [],
  inputTokens: 100,
  outputTokens: 20,
};
const call: Round = {
  text: "",
  calls: [
    { id: "call1", name: "calculator", input: { expression: "(12+3)*4" } },
  ],
  inputTokens: 100,
  outputTokens: 20,
};
function fixture(rounds: Round[], size = 100) {
  const observations: string[] = [],
    events: AgentEvent[] = [],
    saved = new Map<string, StoredStep>();
  let calls = 0;
  const session: ModelSession = {
    size: () => size,
    async next() {
      return rounds[Math.min(calls++, rounds.length - 1)];
    },
    observe(_call, output) {
      observations.push(output);
    },
  };
  return {
    observations,
    events,
    saved,
    session,
    calls: () => calls,
    run: (overrides: Partial<Limits> = {}) =>
      runAgent({
        session,
        limits: { ...limits, ...overrides },
        signal: new AbortController().signal,
        emit: (e) => events.push(e),
        save: async (s) => {
          saved.set(s.id, s);
        },
      }),
  };
}
test("calculator parses precedence without executing code", () => {
  assert.equal(calculate("(12 + 3) * 4"), 60);
  assert.equal(calculate("-2 + 3 * 4"), 10);
  assert.equal(calculate("1e2 / 4"), 25);
  for (const input of [
    "process.exit()",
    "1/0",
    "2**3",
    "1+",
    "(2+3",
    "1 2",
    "Infinity",
  ])
    assert.throws(() => calculate(input));
});
test("SSRF blocks private, reserved, mapped IPv6 and encoded loopback URLs", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.com",
    "http://localhost",
    "http://x.local",
    "http://2130706433",
    "http://0x7f000001",
    "http://[::ffff:127.0.0.1]",
    "https://user:pass@example.com",
    "https://example.com:8080",
  ])
    assert.throws(() => publicUrl(url), url);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  assert.equal(
    publicUrl("https://example.com/a#b").href,
    "https://example.com/a",
  );
});
test("tool validation rejects unknown names and extra arguments before running", async () => {
  const signal = new AbortController().signal;
  assert.equal(
    (await execute("calculator", { expression: "2+2", code: "bad" }, signal))
      .failed,
    true,
  );
  assert.equal(
    (await execute("shell", { command: "echo hi" }, signal)).failed,
    true,
  );
  assert.equal(
    (await execute("fetch_url", { url: "http://127.0.0.1" }, signal)).failed,
    true,
  );
  assert.equal(
    (await execute("calculator", { expression: "2+2" }, signal)).text,
    "4",
  );
});
test("full output is retained while model gets a bounded reference", () => {
  assert.equal(trimOutput("abc", 3, "id"), "abc");
  assert.equal(
    trimOutput("abcdef", 3, "id"),
    "abc\n[Trimmed. Full stored output: id]",
  );
});
test("agent acts, observes and finishes with persisted steps", async () => {
  const f = fixture([call, answer]);
  const result = await f.run();
  assert.equal(result.reason, "done");
  assert.equal(f.calls(), 2);
  assert.equal(f.saved.size, 1);
  assert.equal([...f.saved.values()][0].output, "60");
  assert.match(f.observations[0], /untrustedToolData/);
  assert.deepEqual(
    f.events.map((e) => e.type),
    ["plan", "tool_call", "tool_result", "message_delta", "final"],
  );
});
test("step limits bound repeated tool errors and malformed calls", async () => {
  const f = fixture([
    { ...call, calls: [{ id: "bad", name: "unknown", input: {} }] },
  ]);
  assert.equal((await f.run({ steps: 2 })).reason, "step_limit");
  assert.equal(f.calls(), 2);
  assert.equal(f.saved.size, 2);
});
test("token, context and cost preflight budgets stop before a paid call", async () => {
  for (const overrides of [
    { tokens: 100 },
    { context: 100 },
    { cost: 0.000001 },
  ]) {
    const f = fixture([answer]);
    assert.equal((await f.run(overrides)).reason, "budget");
    assert.equal(f.calls(), 0);
  }
});
test("clarification asks the user and stops without another model call", async () => {
  const f = fixture([
    {
      ...call,
      calls: [
        { id: "ask", name: "ask_user", input: { question: "Which country?" } },
      ],
    },
  ]);
  const result = await f.run();
  assert.equal(result.reason, "needs_user_input");
  assert.match(result.text, /Which country/);
  assert.equal(f.calls(), 1);
});
test("provider failures, cancellation and empty answers have explicit stop reasons", async () => {
  const f = fixture([answer]);
  f.session.next = async () => {
    throw Error("secret provider detail");
  };
  const error = await f.run();
  assert.equal(error.reason, "error");
  assert.doesNotMatch(JSON.stringify(f.events), /secret provider detail/);
  const empty = fixture([{ ...answer, text: "" }]);
  assert.equal((await empty.run()).reason, "error");
  const controller = new AbortController();
  controller.abort();
  const stopped = await runAgent({
    session: fixture([answer]).session,
    limits,
    signal: controller.signal,
    emit() {},
    async save() {},
  });
  assert.equal(stopped.reason, "budget");
});
test("wall time aborts an in-flight model call", async () => {
  const f = fixture([answer]);
  f.session.next = (_max, signal) =>
    new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(Error("timeout"))),
    );
  const keepAlive = setTimeout(() => {}, 100);
  try {
    assert.equal((await f.run({ milliseconds: 10 })).reason, "budget");
  } finally {
    clearTimeout(keepAlive);
  }
});

test("loop persists complete bounded output but observes a trimmed version and real source URLs", async () => {
  const f = fixture([call, answer]);
  const full = "x".repeat(10000);
  const result = await runAgent({
    session: f.session,
    limits,
    signal: new AbortController().signal,
    emit: (e) => f.events.push(e),
    save: async (s) => {
      f.saved.set(s.id, s);
    },
    tool: async () => ({
      text: full,
      sources: ["https://example.com/"],
      failed: false,
      maxOutput: 1000,
    }),
  });
  assert.equal([...f.saved.values()][0].output, full);
  assert.ok(f.observations[0].length < 1500);
  assert.match(f.observations[0], /Full stored output/);
  assert.match(result.text, /Sources consulted/);
});
