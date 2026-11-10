import { authorize, failure, HttpError } from "@/lib/access";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const user = await authorize(req);
    const admins = (process.env.AGENT_ADMIN_USER_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (!admins.includes(user.id))
      throw new HttpError(
        403,
        "Only workspace administrators can read agent audit logs.",
      );
    const rows = await db.agentAudit.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return Response.json(
      { rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
