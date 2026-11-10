import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authorize, failure, HttpError, readJson } from "@/lib/access";
import { db } from "@/lib/db";
import { agentEnabled, untrustedData } from "@/lib/agent/safety";
import { agentConfig, modelSession } from "@/lib/agent/provider";
import { persistence } from "@/lib/agent/persistence";
import {
  agentRequest,
  settleSpend,
  dailyBudgetSignal,
} from "@/lib/agent/usage";
import { savePreference } from "@/lib/agent/memory-write";
import { memoryTools } from "@/lib/agent/memory";
import { runAgent } from "@/lib/agent/loop";
import type { Checkpoint } from "@/lib/agent/types";
export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(req: Request) {
  try {
    const user = await authorize(req);
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const confirmation = await db.agentConfirmation.findFirst({
      where: {
        stepId: id,
        step: { run: { message: { conversation: { ownerId: user.id } } } },
      },
      select: { status: true, tainted: true, expiresAt: true, undoId: true },
    });
    if (!confirmation)
      throw new HttpError(404, "This confirmation is unavailable.");
    if (confirmation.undoId) {
      const undo = await db.memoryUndo.findFirst({
        where: { id: confirmation.undoId, ownerId: user.id },
        select: { used: true },
      });
      if (!undo || undo.used) confirmation.undoId = null;
    }
    return Response.json(confirmation, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await authorize(req);
    agentEnabled();
    const body = z
      .object({
        stepId: z.string().uuid(),
        decision: z.enum(["approve", "deny"]),
      })
      .strict()
      .safeParse(await readJson(req));
    if (!body.success)
      throw new HttpError(400, "Choose Approve or Deny for this call.");
    const { stepId, decision } = body.data;
    const pending = await db.agentConfirmation.findFirst({
      where: {
        stepId,
        step: { run: { message: { conversation: { ownerId: user.id } } } },
      },
      include: {
        step: {
          include: {
            run: {
              include: { checkpoint: true, reservation: true, message: true },
            },
          },
        },
      },
    });
    if (!pending) throw new HttpError(404, "This confirmation is unavailable.");
    const run = pending.step.run,
      checkpoint = run.checkpoint;
    if (
      !checkpoint ||
      pending.status !== "pending" ||
      run.status !== "needs_user_input" ||
      checkpoint.expiresAt <= new Date() ||
      pending.expiresAt <= new Date() ||
      run.reservation?.day !== new Date().toISOString().slice(0, 10) ||
      run.reservation.settled
    )
      throw new HttpError(
        409,
        "This confirmation has expired or was already used. Send a new message to continue.",
      );
    const state: Checkpoint = JSON.parse(checkpoint.state);
    if (
      state.stepId !== stepId ||
      JSON.stringify(state.call.input) !== pending.step.input ||
      state.call.name !== pending.step.name
    )
      throw new HttpError(
        409,
        "This call no longer matches its saved confirmation.",
      );
    const settings = agentConfig(
      new Request(req.url, {
        headers: { "x-forge-provider": checkpoint.provider },
      }),
      run.model,
    );
    const limits = {
      ...state.limits,
      tokens: Math.min(state.limits.tokens, settings.limits.tokens),
      cost: Math.min(state.limits.cost, settings.limits.cost),
      inputRate: Math.max(state.limits.inputRate, settings.limits.inputRate),
      outputRate: Math.max(state.limits.outputRate, settings.limits.outputRate),
    };
    const lease = randomUUID(),
      now = new Date();
    await db.$transaction(async (tx) => {
      await agentRequest(tx, user.id, false);
      const acquired = await tx.conversation.updateMany({
        where: {
          id: run.message.conversationId,
          ownerId: user.id,
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
        },
        data: { lease, leaseUntil: new Date(Date.now() + 180000) },
      });
      if (!acquired.count)
        throw new HttpError(
          409,
          "This conversation is busy. Wait for its current reply.",
        );
      const consumed = await tx.agentConfirmation.updateMany({
        where: { stepId, status: "pending", expiresAt: { gt: now } },
        data: { status: decision === "approve" ? "approved" : "denied" },
      });
      if (!consumed.count)
        throw new HttpError(409, "This approval was already used.");
      await tx.agentRun.update({
        where: { id: run.id },
        data: { status: "running" },
      });
      await tx.chatMessage.update({
        where: { id: run.messageId },
        data: { status: "streaming" },
      });
    });
    const store = persistence(user.id, run.id, checkpoint.provider);
    const session = modelSession(settings, [], state.session);
    const abort = new AbortController();
    const signal = AbortSignal.any([
      req.signal,
      abort.signal,
      dailyBudgetSignal(),
    ]);
    let content = run.message.content + "\n\n",
      connected = true;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: object) => {
          if (!connected) return;
          try {
            controller.enqueue(
              new TextEncoder().encode(JSON.stringify(event) + "\n"),
            );
          } catch {
            connected = false;
            abort.abort();
          }
        };
        try {
          agentEnabled();
          signal.throwIfAborted();
          const started = Date.now();
          let observation =
              "The user denied this one call. It was not executed. Adjust the plan without repeating this request.",
            failed = false;
          if (decision === "approve") {
            try {
              // Current write capability: preference memory only. Future capabilities must add their own executor here.
              if (state.call.name !== "save_memory")
                throw new HttpError(
                  400,
                  "This action is not supported and was not executed.",
                );
              const undoId = await db.$transaction(async (tx) => {
                const claimed = await tx.agentConfirmation.updateMany({
                  where: { stepId, status: "approved" },
                  data: { status: "completed" },
                });
                if (!claimed.count)
                  throw new HttpError(409, "This call was already executed.");
                const undo = await savePreference(
                  tx,
                  user.id,
                  state.call.input,
                  "Approved agent call",
                );
                await tx.agentConfirmation.update({
                  where: { stepId },
                  data: { undoId: undo },
                });
                return undo;
              });
              observation =
                "Saved to memory: " +
                JSON.stringify(state.call.input) +
                ". The user approved this one call.";
              send({ type: "memory_saved", undoId });
            } catch (error) {
              failed = true;
              observation =
                error instanceof HttpError
                  ? error.message
                  : "This action failed and was not saved.";
              await db.agentConfirmation.updateMany({
                where: { stepId, status: "approved" },
                data: { status: "failed" },
              });
            }
          }
          await store.audit(
            state.call,
            decision === "deny" ? "denied" : failed ? "failed" : "completed",
            Buffer.byteLength(observation),
            Date.now() - started,
          );
          await store.save({
            id: stepId,
            name: state.call.name,
            input: pending.step.input,
            output: observation,
            failed,
            sources: [],
          });
          session.observe(state.call, untrustedData(observation));
          const result = await runAgent({
            ...store,
            session,
            initial: state,
            limits,
            signal,
            tool: memoryTools(user.id),
            emit(event) {
              if (event.type === "message_delta") content += event.text;
              send(event);
            },
          });
          await db.agentRun.update({
            where: { id: run.id },
            data: {
              status: result.reason,
              tokens: result.tokens,
              cost: result.cost,
              finishedAt: new Date(),
            },
          });
          if (result.reason !== "needs_user_input") {
            await settleSpend(run.id, result.cost);
            await db.agentCheckpoint.deleteMany({ where: { runId: run.id } });
          }
          send({ type: "done" });
        } catch {
          await db.agentRun.updateMany({
            where: { id: run.id, status: "running" },
            data: { status: "error", finishedAt: new Date() },
          });
          // Unknown usage is never refunded. A consumed approval is never retried automatically.
          content +=
            "\nThe resumed run stopped. Reopen the conversation to review the saved action status.";
          send({
            type: "error",
            error:
              "The resumed run stopped. Reopen the conversation to review the saved action status.",
          });
        } finally {
          await db.$transaction([
            db.chatMessage.update({
              where: { id: run.messageId },
              data: { content, status: "complete" },
            }),
            db.conversation.updateMany({
              where: { id: run.message.conversationId, lease },
              data: { lease: null, leaseUntil: null },
            }),
          ]);
          if (connected) controller.close();
        }
      },
      cancel() {
        connected = false;
        abort.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
