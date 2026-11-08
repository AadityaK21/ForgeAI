import { authorize, failure, HttpError } from "@/lib/access";
import { requestProviders } from "@/lib/providers";
import { availableModels, providerError } from "@/lib/chat-provider";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    await authorize(req);
    const config = requestProviders(req);
    try {
      return Response.json(
        {
          models: await availableModels(
            config,
            AbortSignal.any([req.signal, AbortSignal.timeout(20000)]),
          ),
          provider: config.provider,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (e) {
      throw new HttpError(400, providerError(e));
    }
  } catch (e) {
    return failure(e);
  }
}
