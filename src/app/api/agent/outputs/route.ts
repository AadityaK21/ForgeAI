import { authorize, failure, HttpError } from "@/lib/access";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const user = await authorize(req);
    const id = new URL(req.url).searchParams.get("id") || "";
    const output = await db.agentOutput.findFirst({
      where: {
        stepId: id,
        step: { run: { message: { conversation: { ownerId: user.id } } } },
      },
    });
    if (!output) throw new HttpError(404, "Tool output not found.");
    return Response.json(
      { content: output.content },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
