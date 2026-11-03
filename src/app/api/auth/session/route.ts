import { failure, sessionUser } from "@/lib/access";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    return Response.json(
      { user: await sessionUser(req) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
