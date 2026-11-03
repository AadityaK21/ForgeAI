import { createHash } from "node:crypto";
import { db } from "./db";
export const cookieName =
  process.env.NODE_ENV === "production"
    ? "__Host-forge_session"
    : "forge_session";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function matchesOrigin(req: Request, origin: string | null) {
  if (!origin) return false;
  const configured = process.env.FORGE_PUBLIC_ORIGIN?.trim();
  if (configured) return origin === configured.replace(/\/$/, "");
  const url = new URL(req.url);
  if (origin === url.origin) return true;
  // Next may give a request for 127.0.0.1 its internal localhost origin.
  const host = req.headers.get("host") || "";
  const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
  return (
    loopback.test(host) &&
    loopback.test(url.host) &&
    origin === url.protocol + "//" + host &&
    new URL(origin).port === url.port
  );
}
export function assertOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (
    (origin && !matchesOrigin(req, origin)) ||
    req.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new HttpError(403, "Open this workspace directly.");
  if (!process.env.BUILDER_ACCESS_TOKEN?.trim()) {
    const host = req.headers.get("host") || "";
    if (
      process.env.NODE_ENV === "production" ||
      !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) ||
      req.headers.has("forwarded") ||
      (req.headers.get("x-forwarded-host") &&
        req.headers.get("x-forwarded-host") !== host)
    )
      throw new HttpError(
        403,
        "Private registration must be configured by the workspace owner.",
      );
  }
}
export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function sessionDigest(req: Request) {
  const cookie = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((value) => value.startsWith(cookieName + "="));
  const value = cookie?.slice(cookieName.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? digest(value) : null;
}
export async function sessionUser(req: Request) {
  assertOrigin(req);
  const digest = sessionDigest(req);
  if (!digest) return null;
  const session = await db.session.findFirst({
    where: { digest, expiresAt: { gt: new Date() } },
    select: { user: { select: { id: true, email: true } } },
  });
  return session?.user ?? null;
}
export async function authorize(req: Request) {
  const user = await sessionUser(req);
  if (!user) throw new HttpError(401, "Sign in to open your workspace.");
  return user;
}
export async function readJson(
  req: Request,
  allowForm = false,
  maximumBytes = 12000,
) {
  const type = req.headers.get("content-type")?.split(";")[0].trim();
  const form = allowForm && type === "application/x-www-form-urlencoded";
  if (!form && type !== "application/json")
    throw new HttpError(415, "Send JSON.");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing request.");
  const decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((bytes += value.byteLength) > maximumBytes) {
      await reader.cancel();
      throw new HttpError(413, "Request is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    text += decoder.decode();
    return form
      ? Object.fromEntries(new URLSearchParams(text))
      : JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
export function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof HttpError
          ? error.message
          : "The workspace could not complete this request.",
    },
    { status: error instanceof HttpError ? error.status : 500 },
  );
}
