import { authorize, HttpError, failure } from "@/lib/access";
import { db } from "@/lib/db";
import { readInstantHtml, instantCsp } from "@/lib/instant-worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const user = await authorize(req);
    const params = new URL(req.url).searchParams;
    const project = await db.project.findFirst({
      where: { id: params.get("projectId") || "", ownerId: user.id },
      select: { sandboxId: true },
    });
    if (
      !project?.sandboxId?.startsWith("instant-") ||
      project.sandboxId !== params.get("sandboxId")
    )
      throw new HttpError(404, "Preview unavailable.");
    return new Response(
      await readInstantHtml(params.get("projectId")!, project.sandboxId),
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy":
            "sandbox allow-scripts; frame-ancestors 'self'; " + instantCsp,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      },
    );
  } catch (e) {
    return failure(e);
  }
}
