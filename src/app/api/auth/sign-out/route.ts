import { db } from "@/lib/db";
import { assertOrigin, failure, sessionDigest, readJson } from "@/lib/access";
import { sessionCookie } from "@/lib/account";
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    await readJson(req);
    const digest = sessionDigest(req);
    if (digest) await db.session.deleteMany({ where: { digest } });
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": sessionCookie("", 0),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return failure(e);
  }
}
