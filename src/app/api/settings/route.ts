import { z } from "zod";
import {
  authorize,
  readJson,
  HttpError,
  failure,
  matchesOrigin,
} from "@/lib/access";
import {
  canSaveKeys,
  requestProviders,
  providerStatus,
  submittedKeys,
} from "@/lib/providers";
import { saveEnvironment } from "@/lib/server-settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function status(req: Request, userId: string) {
  return Response.json(
    providerStatus(requestProviders(req), canSaveKeys(req, userId)),
    {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
export async function GET(req: Request) {
  try {
    return status(req, (await authorize(req)).id);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const user = await authorize(req);
    const body = z
      .object({ persist: z.boolean() })
      .strict()
      .safeParse(await readJson(req));
    if (!body.success)
      throw new HttpError(400, "Choose how to use these keys.");
    requestProviders(req);
    if (body.data.persist) {
      if (
        !canSaveKeys(req, user.id) ||
        !matchesOrigin(req, req.headers.get("origin"))
      )
        throw new HttpError(
          403,
          "Only the configured local settings owner can save keys on this machine.",
        );
      const updates = submittedKeys(req);
      if (!Object.keys(updates).length)
        throw new HttpError(400, "Enter a key to save.");
      await saveEnvironment(updates);
      Object.assign(process.env, updates);
    }
    return status(req, user.id);
  } catch (e) {
    return failure(e);
  }
}
