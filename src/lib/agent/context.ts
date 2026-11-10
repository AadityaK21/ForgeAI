import type { Turn } from "./types";

export type ContextTurn = Turn & { id: string };
export type ContextSnapshot = {
  version: 1;
  method: "extractive";
  beforeBytes: number;
  afterBytes: number;
  entries: { messageId: string; excerpt: string }[];
};
export function contextBytes(turns: Turn[]) {
  return Buffer.byteLength(
    JSON.stringify(turns.map(({ role, content }) => ({ role, content }))),
  );
}

// Never rewrite a user's goals or the recent conversation. This summary makes no
// new claims and needs no additional model call, token spend or external service.
export function compactHistory(history: ContextTurn[], budget: number) {
  const original = history.map(({ role, content }) => ({ role, content }));
  const beforeBytes = contextBytes(original);
  if (beforeBytes <= budget * 0.8 || history.length <= 6)
    return { messages: original, snapshot: null };
  const entries: ContextSnapshot["entries"] = [];
  const messages = history.map((turn, index): Turn => {
    if (
      turn.role === "user" ||
      index >= history.length - 6 ||
      turn.content.length < 1200
    )
      return { role: turn.role, content: turn.content };
    // Keep questions and explicitly labelled decisions verbatim. If they do not
    // fit, the normal hard context limit still stops the run rather than losing them.
    const protectedLines = turn.content
      .split("\n")
      .filter((line) =>
        /\?|\b(decision|decided|agreed|unresolved|open question|constraint)\b/i.test(
          line,
        ),
      );
    const excerpt =
      turn.content.slice(0, 600) +
      "\n[Older assistant reply shortened. Original message: " +
      turn.id +
      "]" +
      (protectedLines.length
        ? "\nPreserved questions and decisions:\n" + protectedLines.join("\n")
        : "");
    if (Buffer.byteLength(excerpt) >= Buffer.byteLength(turn.content))
      return { role: turn.role, content: turn.content };
    entries.push({ messageId: turn.id, excerpt });
    return { role: turn.role, content: excerpt };
  });
  if (!entries.length) return { messages: original, snapshot: null };
  const snapshot: ContextSnapshot = {
    version: 1,
    method: "extractive",
    beforeBytes,
    afterBytes: contextBytes(messages),
    entries,
  };
  return { messages, snapshot };
}
