import { test } from "node:test";
import assert from "node:assert/strict";
import { compactHistory, type ContextTurn } from "../src/lib/agent/context";
import { runAgent } from "../src/lib/agent/loop";

test("extractive compaction preserves every user turn, recent turns and labelled open decisions", () => {
  const history: ContextTurn[] = Array.from({ length: 20 }, (_, i) => ({
    id: `message-${i}`,
    role: i % 2 ? "assistant" : "user",
    content:
      i % 2
        ? "Explanation. ".repeat(400) +
          "\nOpen question: Which date?\nDecision: Keep the budget under 100."
        : `User goal ${i}: Keep this verbatim.`,
  }));
  const unchanged = JSON.stringify(history);
  const result = compactHistory(history, 10000);
  assert.ok(result.snapshot);
  assert.ok(result.snapshot.afterBytes < result.snapshot.beforeBytes);
  assert.equal(result.snapshot.version, 1);
  history.forEach((turn, i) => {
    if (turn.role === "user" || i >= history.length - 6)
      assert.equal(result.messages[i].content, turn.content);
  });
  assert.match(result.messages[1].content, /Open question: Which date\?/);
  assert.match(
    result.messages[1].content,
    /Decision: Keep the budget under 100\./,
  );
  assert.equal(JSON.stringify(history), unchanged);
  assert.equal(result.snapshot.entries[0].messageId, "message-1");
});
test("small histories and uncompressible context remain intact", () => {
  const history: ContextTurn[] = [
    { id: "1", role: "user", content: "My goal" },
  ];
  assert.equal(compactHistory(history, 10000).snapshot, null);
  const large: ContextTurn[] = Array.from({ length: 10 }, (_, i) => ({
    id: String(i),
    role: "user",
    content: "large user goal".repeat(1000),
  }));
  const result = compactHistory(large, 1000);
  assert.equal(result.snapshot, null);
  assert.deepEqual(
    result.messages.map((m) => m.content),
    large.map((m) => m.content),
  );
});
test("approved-value proposal pauses for the user's click instead of claiming memory was saved", async () => {
  const result = await runAgent({
    session: {
      size: () => 100,
      next: async () => ({
        text: "",
        calls: [
          {
            id: "proposal",
            name: "save_memory",
            input: { category: "tone", value: "Friendly" },
          },
        ],
        inputTokens: 100,
        outputTokens: 20,
      }),
      observe() {
        assert.fail("must stop for user consent");
      },
    },
    limits: {
      steps: 12,
      milliseconds: 1000,
      tokens: 60000,
      context: 32000,
      cost: 0.5,
      inputRate: 3,
      outputRate: 15,
      searchCost: 0.01,
    },
    signal: new AbortController().signal,
    emit() {},
    async save() {},
    tool: async () => ({
      text: "proposed",
      sources: [],
      failed: false,
      maxOutput: 2000,
    }),
  });
  assert.equal(result.reason, "needs_user_input");
  assert.match(result.text, /Nothing has been saved yet/);
});
