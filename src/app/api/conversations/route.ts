import { z } from "zod";
import { authorize, failure, HttpError, readJson } from "@/lib/access";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
const idSchema = z.string().cuid();
export async function GET(req: Request) {
  try {
    const user = await authorize(req);
    const url = new URL(req.url),
      id = url.searchParams.get("id");
    if (id) {
      if (!idSchema.safeParse(id).success)
        throw new HttpError(400, "Invalid conversation.");
      const conversation = await db.conversation.findFirst({
        where: { id, ownerId: user.id },
        include: {
          messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        },
      });
      if (!conversation) throw new HttpError(404, "Conversation not found.");
      // Recover interrupted server requests without claiming an unfinished reply completed.
      if (!conversation.leaseUntil || conversation.leaseUntil <= new Date()) {
        await db.chatMessage.updateMany({
          where: {
            conversationId: id,
            status: "streaming",
            conversation: {
              OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
            },
          },
          data: {
            status: "interrupted",
            error: "The response was interrupted. You can retry it.",
          },
        });
        conversation.messages = conversation.messages.map((m) =>
          m.status === "streaming"
            ? {
                ...m,
                status: "interrupted",
                error: "The response was interrupted. You can retry it.",
              }
            : m,
        );
      }
      return Response.json(
        {
          conversation: {
            id: conversation.id,
            title: conversation.title,
            messages: conversation.messages,
            updatedAt: conversation.updatedAt,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .safeParse(url.searchParams.get("offset") || 0);
    if (!offset.success) throw new HttpError(400, "Invalid page.");
    const conversations = await db.conversation.findMany({
      where: {
        ownerId: user.id,
        ...(q
          ? {
              OR: [
                { title: { contains: q } },
                { messages: { some: { content: { contains: q } } } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: offset.data,
      take: 51,
      select: { id: true, title: true, updatedAt: true },
    });
    return Response.json(
      {
        conversations: conversations.slice(0, 50),
        hasMore: conversations.length > 50,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request) {
  try {
    const user = await authorize(req);
    const input = z
      .object({ id: idSchema, title: z.string().trim().min(1).max(100) })
      .strict()
      .safeParse(await readJson(req));
    if (!input.success)
      throw new HttpError(400, "Enter a title of 1 to 100 characters.");
    const result = await db.conversation.updateMany({
      where: { id: input.data.id, ownerId: user.id },
      data: { title: input.data.title },
    });
    if (!result.count) throw new HttpError(404, "Conversation not found.");
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: Request) {
  try {
    const user = await authorize(req);
    const input = z
      .object({ id: idSchema })
      .strict()
      .safeParse(await readJson(req));
    if (!input.success) throw new HttpError(400, "Invalid conversation.");
    const result = await db.conversation.deleteMany({
      where: {
        id: input.data.id,
        ownerId: user.id,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
    });
    if (!result.count)
      throw new HttpError(
        409,
        "Conversation unavailable or still generating. Stop the response before deleting it.",
      );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
