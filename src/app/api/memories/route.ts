import { z } from "zod";
import { authorize, failure, HttpError, readJson } from "@/lib/access";
import { savePreference } from "@/lib/agent/memory-write";
import { db } from "@/lib/db";
import { preferenceSchema } from "@/lib/memory-options";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await authorize(req);
    const settings = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { memoryEnabled: true },
    });
    const memories = await db.preferenceMemory.findMany({
      where: { ownerId: user.id },
      orderBy: { category: "asc" },
    });
    return Response.json(
      { enabled: settings.memoryEnabled, memories },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request) {
  try {
    const user = await authorize(req);
    const parsed = z
      .object({ enabled: z.boolean() })
      .strict()
      .safeParse(await readJson(req));
    if (!parsed.success)
      throw new HttpError(400, "Choose whether to enable preference memory.");
    await db.user.update({
      where: { id: user.id },
      data: { memoryEnabled: parsed.data.enabled },
    });
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const user = await authorize(req);
    const body = z
      .object({
        preference: preferenceSchema,
        stepId: z.string().uuid().optional(),
        confirmed: z.literal(true),
      })
      .strict()
      .safeParse(await readJson(req));
    if (!body.success)
      throw new HttpError(
        400,
        "Review a supported language, tone or detail preference before saving. Free text and private details are not allowed.",
      );
    if (body.data.stepId)
      throw new HttpError(
        409,
        "Use Approve or Deny on the agent confirmation card. This proposal cannot be saved through Settings.",
      );
    const undoId = await db.$transaction((tx) =>
      savePreference(tx, user.id, body.data.preference, "Settings"),
    );
    return Response.json({ ok: true, undoId });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: Request) {
  try {
    const user = await authorize(req);
    const parsed = z
      .object({ category: z.enum(["language", "tone", "detail"]).optional() })
      .strict()
      .safeParse(await readJson(req));
    if (!parsed.success)
      throw new HttpError(400, "Choose a preference to delete.");
    await db.preferenceMemory.deleteMany({
      where: {
        ownerId: user.id,
        ...(parsed.data.category ? { category: parsed.data.category } : {}),
      },
    });
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
