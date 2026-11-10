import { HttpError } from "../access";
import { agentEnabled, requiresConfirmation, untrustedData } from "./safety";
import { preferenceSchema } from "../memory-options";
import type { Checkpoint, RunState, Call } from "./types";
import { randomUUID } from "node:crypto";
import { askSchema, execute, trimOutput } from "./tools";
import type {
  AgentEvent,
  Limits,
  ModelSession,
  StopReason,
  StoredStep,
} from "./types";

export async function runAgent(options: {
  session: ModelSession;
  limits: Limits;
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
  save: (step: StoredStep) => Promise<void>;
  tool?: typeof execute;
  initial?: RunState;
  pause?: (checkpoint: Checkpoint) => Promise<void>;
  audit?: (
    call: Call,
    status: string,
    size: number,
    duration: number,
  ) => Promise<void>;
}) {
  const { session, limits, emit, save } = options;
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(limits.milliseconds),
  ]);
  let tokens = options.initial?.tokens ?? 0,
    cost = options.initial?.cost ?? 0,
    reason: StopReason = "step_limit",
    text = "",
    steps = options.initial?.steps ?? 0;
  let tainted = options.initial?.tainted ?? false;
  let rounds = options.initial?.rounds ?? 0;
  const sources = new Set<string>(options.initial?.sources ?? []);
  emit({
    type: "plan",
    text: "I will check what is needed, use read-only tools where helpful, and report the evidence.",
  });
  try {
    for (; rounds < limits.steps;) {
      agentEnabled();
      rounds++;
      if (signal.aborted) {
        reason = "budget";
        break;
      }
      // UTF-8 bytes plus a framing allowance conservatively reserve input tokens.
      const input = session.size();
      const maxOutput = Math.floor(
        Math.min(
          2048,
          limits.context - input,
          limits.tokens - tokens - input,
          ((limits.cost - cost) * 1e6 - input * limits.inputRate) /
            limits.outputRate,
        ),
      );
      if (maxOutput < 256) {
        reason = "budget";
        break;
      }
      let streamed = false;
      const response = await session
        .next(maxOutput, signal, (delta) => {
          signal.throwIfAborted();
          streamed = true;
          text += delta;
          emit({ type: "message_delta", text: delta });
        })
        .catch((error) => {
          tokens += input + maxOutput;
          cost +=
            (input * limits.inputRate + maxOutput * limits.outputRate) / 1e6;
          throw error;
        });
      tokens += response.inputTokens + response.outputTokens;
      cost +=
        (response.inputTokens * limits.inputRate +
          response.outputTokens * limits.outputRate) /
        1e6;
      if (response.text) {
        const suffix = streamed ? "\n\n" : response.text + "\n\n";
        text += suffix;
        emit({ type: "message_delta", text: suffix });
      }
      if (response.incomplete || tokens > limits.tokens || cost > limits.cost) {
        reason = "budget";
        break;
      }
      if (!response.calls.length) {
        reason = response.text.trim() ? "done" : "error";
        break;
      }
      for (const call of response.calls) {
        if (steps >= limits.steps) {
          reason = "step_limit";
          break;
        }
        signal.throwIfAborted();
        agentEnabled();
        const started = Date.now();
        const id = randomUUID(),
          input = JSON.stringify(call.input ?? null).slice(0, 16000);
        steps++;
        await save({
          id,
          name: call.name,
          input,
          output: "Tool did not finish.",
          failed: true,
          sources: [],
        });
        emit({ type: "tool_call", stepId: id, name: call.name, input });
        await options.audit?.(call, "started", 0, 0);
        if (
          requiresConfirmation(call.name, tainted) &&
          (call.name !== "save_memory" ||
            preferenceSchema.safeParse(call.input).success)
        ) {
          // Complete any unexpected parallel calls with an observation before persisting the native transcript.
          // The supported providers request single calls, but a provider violation must not produce an invalid resume.
          for (const other of response.calls.slice(
            response.calls.indexOf(call) + 1,
          )) {
            await options.audit?.(other, "deferred", 0, 0);
            session.observe(
              other,
              untrustedData(
                "Not executed because another call needs user approval. Request again later.",
              ),
            );
          }
          const note =
            "Review this one tool call, then choose Approve or Deny. Nothing has been saved yet.";
          await save({
            id,
            name: call.name,
            input,
            output: note,
            failed: false,
            sources: [],
          });
          if (options.pause && session.snapshot)
            await options.pause({
              call,
              stepId: id,
              session: session.snapshot(),
              limits,
              tokens,
              cost,
              steps,
              rounds,
              tainted,
              sources: [...sources],
            });
          await options.audit?.(
            call,
            "needs_user_input",
            0,
            Date.now() - started,
          );
          emit({
            type: "tool_result",
            stepId: id,
            name: call.name,
            output: note,
            failed: false,
            sources: [],
          });
          text += note;
          emit({ type: "message_delta", text: note });
          reason = "needs_user_input";
          break;
        }
        if (call.name === "ask_user") {
          const parsed = askSchema.safeParse(call.input);
          if (parsed.success) {
            const question = parsed.data.question;
            await save({
              id,
              name: call.name,
              input,
              output: question,
              failed: false,
              sources: [],
            });
            emit({
              type: "tool_result",
              stepId: id,
              name: call.name,
              output: question,
              failed: false,
              sources: [],
            });
            await options.audit?.(
              call,
              "needs_user_input",
              Buffer.byteLength(question),
              Date.now() - started,
            );
            text += question;
            emit({ type: "message_delta", text: question });
            reason = "needs_user_input";
            break;
          }
        }
        if (call.name === "web_search") {
          if (cost + limits.searchCost > limits.cost) {
            await options.audit?.(call, "budget", 0, Date.now() - started);
            reason = "budget";
            break;
          }
          cost += limits.searchCost;
        }
        if (call.name === "web_search" || call.name === "fetch_url")
          tainted = true;
        const result = await (options.tool || execute)(
          call.name,
          call.input,
          signal,
        );
        await options.audit?.(
          call,
          result.failed ? "failed" : "completed",
          Buffer.byteLength(result.text),
          Date.now() - started,
        );
        const full = result.text.slice(0, 110000);
        await save({
          id,
          name: call.name,
          input,
          output: full,
          failed: result.failed,
          sources: result.sources,
        });
        const output = trimOutput(full, result.maxOutput, id);
        result.sources.forEach((s) => sources.add(s));
        emit({
          type: "tool_result",
          stepId: id,
          name: call.name,
          output,
          failed: result.failed,
          sources: result.sources,
        });
        session.observe(call, untrustedData(output, result.sources));
      }
      if (
        reason === "needs_user_input" ||
        reason === "budget" ||
        steps >= limits.steps
      )
        break;
    }
  } catch (error) {
    reason = signal.aborted ? "budget" : "error";
    emit({
      type: "error",
      error: signal.aborted
        ? "Agent run stopped or reached its time limit."
        : error instanceof HttpError
          ? error.message
          : "The agent could not finish. Saved tool steps are available below.",
    });
  }
  if (sources.size) {
    const citations =
      "\n\nSources consulted:\n" +
      [...sources].map((s, i) => `- [Source ${i + 1}](${s})`).join("\n");
    text += citations;
    emit({ type: "message_delta", text: citations });
  }
  if (reason !== "done" && reason !== "needs_user_input") {
    const note = `\n\nStopped: ${reason.replaceAll("_", " ")}. Send a follow-up to continue.`;
    text += note;
    emit({ type: "message_delta", text: note });
  }
  emit({ type: "final", reason, tokens, cost });
  return { reason, tokens, cost, text, steps, rounds, tainted };
}
