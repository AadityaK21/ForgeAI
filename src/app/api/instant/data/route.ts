import { authorize, readJson, HttpError, failure } from "@/lib/access";
import { db } from "@/lib/db";
import { instantDataRequest } from "@/lib/instant-data";
import { z } from "zod";
export const runtime = "nodejs";
const input = z
  .object({
    projectId: z.string().min(1).max(100),
    sandboxId: z.string().max(60),
    method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
    path: z.string().max(170),
    body: z.unknown().optional(),
  })
  .strict();
export async function POST(req: Request) {
  try {
    const user = await authorize(req);
    const data = input.safeParse(await readJson(req));
    if (!data.success)
      throw new HttpError(400, "Invalid project data request.");
    const { projectId, sandboxId, method, path, body } = data.data;
    const row = await db.project.findFirst({
      where: { id: projectId, ownerId: user.id, sandboxId },
      select: { id: true },
    });
    if (!row || !sandboxId.startsWith("instant-"))
      throw new HttpError(404, "Unknown preview.");
    const result = await instantDataRequest(projectId, method, path, body);
    return Response.json(result.body, {
      status: result.status,
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
