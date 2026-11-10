import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { HttpError } from "../access";
import { safetyConfig } from "./safety";

export function dailyBudgetSignal() {
  const now = Date.now();
  const midnight =
    Date.parse(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z") +
    86400000;
  return AbortSignal.timeout(Math.max(1, Math.min(150000, midnight - now)));
}

export async function agentRequest(
  tx: Prisma.TransactionClient,
  userId: string,
  newRun: boolean,
  now = new Date(),
) {
  const config = safetyConfig();
  const minute = Math.floor(now.getTime() / 60000);
  const day = now.toISOString().slice(0, 10);
  const windows = [
    {
      key: `agent-minute:${userId}:${minute}`,
      max: config.rpm,
      end: new Date((minute + 1) * 60000),
      message: "You've reached the agent request limit. Please wait a minute.",
    },
  ];
  if (newRun)
    windows.push({
      key: `agent-day:${userId}:${day}`,
      max: config.daily,
      end: new Date(day + "T23:59:59.999Z"),
      message:
        "You've reached today's agent run limit. Please try tomorrow (UTC).",
    });
  for (const window of windows) {
    const value = await tx.authAttempt.upsert({
      where: { key: window.key },
      create: { key: window.key, count: 1, expiresAt: window.end },
      update: { count: { increment: 1 } },
    });
    if (value.count > window.max) throw new HttpError(429, window.message);
  }
}
export async function reserveSpend(
  tx: Prisma.TransactionClient,
  runId: string,
  cost: number,
  now = new Date(),
) {
  const day = now.toISOString().slice(0, 10),
    micros = Math.ceil(cost * 1e6);
  const cap = Math.floor(safetyConfig().global * 1e6);
  await tx.agentSpend.upsert({ where: { day }, create: { day }, update: {} });
  const reserved = await tx.agentSpend.updateMany({
    where: { day, micros: { lte: cap - micros } },
    data: { micros: { increment: micros } },
  });
  if (!reserved.count)
    throw new HttpError(
      429,
      "Today's shared agent budget is fully used or reserved by active runs. Please try later.",
    );
  await tx.agentReservation.create({ data: { runId, day, micros } });
}
export async function settleSpend(runId: string, cost: number) {
  await db.$transaction(async (tx) => {
    const reservation = await tx.agentReservation.findUnique({
      where: { runId },
    });
    if (!reservation || reservation.settled) return;
    const changed = await tx.agentReservation.updateMany({
      where: { runId, settled: false },
      data: { settled: true },
    });
    if (!changed.count) return;
    // Failed streams retain their reserved token estimate. Crashes keep the whole reservation.
    const refund = Math.max(0, reservation.micros - Math.ceil(cost * 1e6));
    await tx.agentSpend.update({
      where: { day: reservation.day },
      data: { micros: { decrement: refund } },
    });
  });
}
