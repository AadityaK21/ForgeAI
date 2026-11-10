import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authorize, failure, HttpError, readJson } from "@/lib/access";
import { db } from "@/lib/db";
import { requestProviders } from "@/lib/providers";
import { chatText, providerError, type ChatTurn } from "@/lib/chat-provider";
import { agentConfig, modelSession } from "@/lib/agent/provider";
import { compactHistory } from "@/lib/agent/context";
import { memoryTools } from "@/lib/agent/memory";
import { runAgent } from "@/lib/agent/loop";
import { persistence } from "@/lib/agent/persistence";
import {
  agentRequest,
  reserveSpend,
  settleSpend,
  dailyBudgetSignal,
} from "@/lib/agent/usage";
export const runtime = "nodejs";
export const maxDuration = 180;
const inputSchema = z
  .object({
    conversationId: z.string().cuid().optional(),
    agentMode: z.boolean().optional(),
    requestId: z.string().uuid(),
    message: z.string().trim().min(1).max(16000).optional(),
    retryId: z.string().cuid().optional(),
    model: z
      .string()
      .regex(/^[a-zA-Z0-9._:/-]{1,150}$/)
      .optional(),
  })
  .strict()
  .refine((v) => Boolean(v.message) !== Boolean(v.retryId));

export async function POST(req: Request) {
  try {
    const user = await authorize(req);
    const parsed = inputSchema.safeParse(await readJson(req, false, 70000));
    if (!parsed.success)
      throw new HttpError(400, "Enter a message of up to 16,000 characters.");
    const input = parsed.data;
    const saved = input.conversationId
      ? await db.conversation.findFirst({
          where: { id: input.conversationId, ownerId: user.id },
          select: { agentMode: true },
        })
      : null;
    const agentMode = input.agentMode ?? saved?.agentMode ?? false;
    const agent = agentMode ? agentConfig(req, input.model) : null;
    const config = agent ? agent.config : requestProviders(req);
    if (config.missing.length)
      throw new HttpError(
        400,
        "Choose a provider and add its API key in Settings before sending a message.",
      );
    const model = input.model || config.modelLabel;
    if (
      (config.provider === "anthropic" && !model.startsWith("claude-")) ||
      (config.provider === "openai" && !/^(gpt-|o[134])/.test(model)) ||
      (config.provider === "local" && model !== config.modelLabel)
    )
      throw new HttpError(
        400,
        "Choose a model belonging to the selected provider in Settings.",
      );
    const now = new Date(),
      lease = randomUUID();
    const prepared = await db.$transaction(async (tx) => {
      let conversation = input.conversationId
        ? await tx.conversation.findFirst({
            where: { id: input.conversationId, ownerId: user.id },
          })
        : null;
      if (input.conversationId && !conversation)
        throw new HttpError(404, "Conversation not found.");
      if (input.retryId && !conversation)
        throw new HttpError(400, "Open the conversation before retrying.");
      // A durable per-user limit, shared by all deployment instances.
      const slot = Math.floor(now.getTime() / 600000);
      await tx.authAttempt.deleteMany({ where: { expiresAt: { lte: now } } });
      const attempts = await tx.authAttempt.upsert({
        where: { key: `chat:${user.id}:${slot}` },
        create: {
          key: `chat:${user.id}:${slot}`,
          count: 1,
          expiresAt: new Date((slot + 1) * 600000),
        },
        update: { count: { increment: 1 } },
      });
      if (attempts.count > 30)
        throw new HttpError(
          429,
          "You've sent 30 messages in ten minutes. Please wait before sending another.",
        );
      if (agentMode) await agentRequest(tx, user.id, true, now);
      if (!conversation)
        conversation = await tx.conversation.create({
          data: {
            ownerId: user.id,
            title: input.message!.replace(/\s+/g, " ").slice(0, 70),
          },
        });
      const acquired = await tx.conversation.updateMany({
        where: {
          id: conversation.id,
          ownerId: user.id,
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
        },
        data: {
          lease,
          leaseUntil: new Date(now.getTime() + 180000),
          agentMode,
        },
      });
      if (!acquired.count)
        throw new HttpError(
          409,
          "This conversation is already generating a reply. Wait for it to finish.",
        );
      await tx.chatMessage.updateMany({
        where: { conversationId: conversation.id, status: "streaming" },
        data: { status: "interrupted", error: "The response was interrupted." },
      });
      const history = await tx.chatMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          agentRuns: {
            include: {
              steps: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
            },
          },
        },
      });
      if (
        history.length >= (agent ? 600 : 200) ||
        history.reduce((n, m) => n + m.content.length, 0) +
          (input.message?.length || 0) >
          (agent ? 500000 : 100000)
      )
        throw new HttpError(
          413,
          "This conversation has reached its context limit. Start a new chat to continue.",
        );
      let assistant;
      if (input.retryId) {
        const last = history.at(-1);
        if (
          !last ||
          last.id !== input.retryId ||
          last.role !== "assistant" ||
          last.status === "complete"
        )
          throw new HttpError(
            409,
            "Only the last interrupted or failed response can be retried.",
          );
        history.pop();
        assistant = await tx.chatMessage.update({
          where: { id: last.id },
          data: { content: "", status: "streaming", error: null, model },
        });
      } else {
        if (
          await tx.chatMessage.findUnique({
            where: {
              conversationId_requestId: {
                conversationId: conversation.id,
                requestId: input.requestId,
              },
            },
          })
        )
          throw new HttpError(
            409,
            "This message has already been submitted. Reopen the conversation to see it.",
          );
        const message = await tx.chatMessage.create({
          data: {
            conversationId: conversation.id,
            role: "user",
            content: input.message!,
            requestId: input.requestId,
            createdAt: now,
          },
        });
        history.push({ ...message, agentRuns: [] });
        assistant = await tx.chatMessage.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            status: "streaming",
            model,
            createdAt: new Date(now.getTime() + 1),
          },
        });
      }
      const messages: ChatTurn[] = history
        .filter((m) => m.role === "user" || Boolean(m.content))
        .map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
        }));
      const compacted = agent
        ? compactHistory(
            history
              .filter((m) => m.role === "user" || Boolean(m.content))
              .map((m) => ({
                id: m.id,
                role: m.role === "user" ? "user" : "assistant",
                content: m.content,
              })),
            Math.max(1000, agent.limits.context - 10000),
          )
        : { messages, snapshot: null };
      const run = agent
        ? await tx.agentRun.create({
            data: {
              messageId: assistant.id,
              model,
              contextSnapshot: compacted.snapshot
                ? JSON.stringify(compacted.snapshot)
                : null,
            },
          })
        : null;
      if (run && agent) await reserveSpend(tx, run.id, agent.limits.cost, now);
      return {
        conversation,
        assistant,
        history,
        messages: compacted.messages,
        run,
      };
    });
    const abort = new AbortController();
    const signal = AbortSignal.any([
      abort.signal,
      req.signal,
      agent ? dailyBudgetSignal() : AbortSignal.timeout(150000),
    ]);
    const encoder = new TextEncoder();
    let connected = true;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: object) => {
          if (connected) {
            try {
              controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
            } catch {
              connected = false;
              abort.abort();
            }
          }
        };
        let content = "",
          status = "complete",
          error: string | null = null,
          lastSave = Date.now();
        send({
          type: "start",
          conversation: {
            id: prepared.conversation.id,
            title: prepared.conversation.title,
            updatedAt: now,
            agentMode,
          },
          messages: [
            ...prepared.history,
            {
              ...prepared.assistant,
              agentRuns: prepared.run ? [{ ...prepared.run, steps: [] }] : [],
            },
          ],
        });
        try {
          if (agent && prepared.run) {
            const store = persistence(
              user.id,
              prepared.run.id,
              agent.config.provider!,
            );
            const result = await runAgent({
              ...store,
              session: modelSession(agent, prepared.messages),
              tool: memoryTools(user.id),
              limits: agent.limits,
              signal,
              emit(event) {
                if (event.type === "message_delta") content += event.text;
                send({
                  ...event,
                  id: prepared.assistant.id,
                  runId: prepared.run!.id,
                });
              },
              async save(step) {
                await store.save(step);
                await db.chatMessage.update({
                  where: { id: prepared.assistant.id },
                  data: { content },
                });
              },
            });
            content = result.text;
            if (result.reason !== "needs_user_input")
              await settleSpend(prepared.run.id, result.cost);
            status =
              result.reason === "done" || result.reason === "needs_user_input"
                ? "complete"
                : "stopped";
            await db.agentRun.update({
              where: { id: prepared.run.id },
              data: {
                status: result.reason,
                tokens: result.tokens,
                cost: result.cost,
                finishedAt: new Date(),
              },
            });
          } else {
            for await (const delta of chatText(
              config,
              model,
              prepared.messages,
              signal,
            )) {
              signal.throwIfAborted();
              if (content.length + delta.length > 100000)
                throw new HttpError(
                  422,
                  "The answer reached its length limit.",
                );
              content += delta;
              send({ type: "delta", text: delta, id: prepared.assistant.id });
              if (Date.now() - lastSave > 1500) {
                await db.chatMessage.update({
                  where: { id: prepared.assistant.id },
                  data: { content },
                });
                lastSave = Date.now();
              }
            }
          }
          if (!content.trim())
            throw new HttpError(
              422,
              "The model returned no text. Try again or choose another model.",
            );
        } catch (e) {
          status = signal.aborted ? "stopped" : "error";
          error = signal.aborted
            ? "Response stopped. You can retry or send a follow-up."
            : providerError(e);
        } finally {
          try {
            if (prepared.run)
              await db.agentRun.updateMany({
                where: { id: prepared.run.id, status: "running" },
                data: { status: "error", finishedAt: new Date() },
              });
            await db.$transaction([
              db.chatMessage.update({
                where: { id: prepared.assistant.id },
                data: { content, status, error },
              }),
              db.conversation.updateMany({
                where: { id: prepared.conversation.id, lease },
                data: { lease: null, leaseUntil: null, updatedAt: new Date() },
              }),
            ]);
            send({ type: "done", id: prepared.assistant.id, status, error });
          } catch {
            send({
              type: "error",
              error:
                "The response could not be saved. Copy it before refreshing and try again later.",
            });
          }
          if (connected) {
            try {
              controller.close();
            } catch {}
          }
        }
      },
      cancel() {
        connected = false;
        abort.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
