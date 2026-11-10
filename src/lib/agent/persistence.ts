import { db } from "../db";
import { effect, redactedArguments } from "./safety";
import { trimOutput } from "./tools";
import type { Call, Checkpoint, StoredStep } from "./types";

export function persistence(userId: string, runId: string, provider: string) {
  return {
    async audit(
      call: Call,
      status: string,
      resultSize: number,
      durationMs: number,
    ) {
      await db.agentAudit.create({
        data: {
          userId,
          runId,
          tool: effect(call.name) !== "unknown" ? call.name : "unknown",
          arguments: redactedArguments(call.input),
          resultSize,
          durationMs,
          status,
        },
      });
    },
    async save(step: StoredStep) {
      const data = {
        preview: trimOutput(step.output, 6000, step.id),
        failed: step.failed,
        sources: JSON.stringify(step.sources),
      };
      await db.$transaction([
        db.agentStep.upsert({
          where: { id: step.id },
          create: {
            id: step.id,
            runId,
            name: step.name,
            input: step.input,
            ...data,
          },
          update: data,
        }),
        db.agentOutput.upsert({
          where: { stepId: step.id },
          create: { stepId: step.id, content: step.output },
          update: { content: step.output },
        }),
      ]);
    },
    async pause(checkpoint: Checkpoint) {
      // A reservation belongs to one UTC day. Pauses expire at that day's end or in one hour.
      const expiry = new Date(
        Math.min(
          Date.now() + 3600000,
          new Date(
            new Date().toISOString().slice(0, 10) + "T23:59:59.999Z",
          ).getTime(),
        ),
      );
      await db.$transaction([
        db.agentCheckpoint.upsert({
          where: { runId },
          create: {
            runId,
            state: JSON.stringify(checkpoint),
            provider,
            expiresAt: expiry,
          },
          update: {
            state: JSON.stringify(checkpoint),
            provider,
            expiresAt: expiry,
          },
        }),
        db.agentConfirmation.create({
          data: {
            stepId: checkpoint.stepId,
            tainted: checkpoint.tainted,
            expiresAt: expiry,
          },
        }),
      ]);
    },
  };
}
