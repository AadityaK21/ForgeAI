import { z } from "zod";
import { authorize, failure, HttpError, readJson } from "@/lib/access";
import { db } from "@/lib/db";
export async function POST(req: Request) {
  try {
    const user = await authorize(req);
    const body = z
      .object({ id: z.string().cuid() })
      .strict()
      .safeParse(await readJson(req));
    if (!body.success)
      throw new HttpError(400, "Choose a saved preference to undo.");
    await db.$transaction(async (tx) => {
      const undo = await tx.memoryUndo.findFirst({
        where: {
          id: body.data.id,
          ownerId: user.id,
          used: false,
          expiresAt: { gt: new Date() },
        },
      });
      if (!undo)
        throw new HttpError(409, "This undo has expired or was already used.");
      const current = await tx.preferenceMemory.findFirst({
        where: { id: undo.memoryId, ownerId: user.id, updatedAt: undo.savedAt },
      });
      if (!current)
        throw new HttpError(
          409,
          "This preference changed after the save. Manage its current value in Settings.",
        );
      await tx.memoryUndo.update({
        where: { id: undo.id },
        data: { used: true },
      });
      if (undo.previous) {
        const previous = JSON.parse(undo.previous);
        await tx.preferenceMemory.update({
          where: { id: current.id },
          data: {
            value: previous.value,
            source: previous.source,
            expiresAt: new Date(previous.expiresAt),
            updatedAt: new Date(
              Math.max(Date.now(), current.updatedAt.getTime() + 1),
            ),
          },
        });
      } else await tx.preferenceMemory.delete({ where: { id: current.id } });
    });
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
