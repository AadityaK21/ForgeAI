import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import {
  assertOrigin,
  cookieName,
  digest,
  failure,
  HttpError,
  readJson,
} from "./access";

const credentials = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(1).max(256),
    invite: z.string().max(1024).optional(),
  })
  .strict();
const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const sessionSeconds = 7 * 24 * 60 * 60;
function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 64, parameters, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return (
    salt.toString("hex") + "." + (await derive(password, salt)).toString("hex")
  );
}
export async function matchesPassword(password: string, hash: string) {
  const [salt, key] = hash.split(".");
  if (!/^[a-f\d]{32}$/.test(salt) || !/^[a-f\d]{128}$/.test(key)) return false;
  return timingSafeEqual(
    await derive(password, Buffer.from(salt, "hex")),
    Buffer.from(key, "hex"),
  );
}
export function sessionCookie(value: string, maxAge = sessionSeconds) {
  return (
    cookieName +
    "=" +
    value +
    "; HttpOnly; Path=/; SameSite=Lax; Max-Age=" +
    maxAge +
    (process.env.NODE_ENV === "production" ? "; Secure" : "")
  );
}
// Reserve attempts before password derivation, across processes, including unknown accounts.
async function reserveAttempt(email: string, kind: string) {
  const window = 10 * 60_000,
    now = Date.now(),
    slot = Math.floor(now / window);
  const expiresAt = new Date((slot + 1) * window);
  const counts = await db.$transaction(async (tx) => {
    await tx.authAttempt.deleteMany({
      where: { expiresAt: { lte: new Date(now) } },
    });
    return Promise.all(
      [kind, kind + ":" + digest(email)].map((prefix) => {
        const key = prefix + ":" + slot;
        return tx.authAttempt.upsert({
          where: { key },
          create: { key, count: 1, expiresAt },
          update: { count: { increment: 1 } },
          select: { count: true },
        });
      }),
    );
  });
  if (counts[0].count > 100 || counts[1].count > 12)
    throw new HttpError(429, "Too many attempts. Try again in ten minutes.");
}
export function strong(password: string) {
  return (
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9\s]/.test(password)
  );
}
export async function authenticate(req: Request, signup: boolean) {
  try {
    assertOrigin(req);
    const input = credentials.safeParse(await readJson(req, true));
    if (!input.success)
      throw new HttpError(400, "Enter a valid email address and password.");
    const { email, password, invite } = input.data;
    await reserveAttempt(email, signup ? "register" : "login");
    let userId: string;
    if (signup) {
      const key = process.env.BUILDER_ACCESS_TOKEN?.trim();
      if (
        key &&
        !timingSafeEqual(
          Buffer.from(digest(invite || ""), "hex"),
          Buffer.from(digest(key), "hex"),
        )
      )
        throw new HttpError(
          403,
          "Enter the invitation code from the workspace owner.",
        );
      if (!strong(password))
        throw new HttpError(
          400,
          "Use at least 8 characters, including uppercase, lowercase, a number and a symbol.",
        );
      const passwordHash = await hashPassword(password);
      try {
        const user = await db.user.create({
          data: {
            email,
            passwordHash,
            projects: {
              create: {
                title: "First project",
                files: {
                  create: {
                    path: "BRIEF.md",
                    content:
                      "# Project brief\n\nDescribe the customer, their problem, and one task the first version should help them complete.\n",
                  },
                },
              },
            },
          },
          select: { id: true },
        });
        userId = user.id;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        )
          throw new HttpError(
            409,
            "Unable to create this account. Try signing in.",
          );
        throw e;
      }
    } else {
      const user = await db.user.findUnique({
        where: { email },
        select: { id: true, passwordHash: true },
      });
      const match = await matchesPassword(
        password,
        user?.passwordHash || "0".repeat(32) + "." + "0".repeat(128),
      );
      if (!user || !match)
        throw new HttpError(401, "Email or password is incorrect.");
      userId = user.id;
    }
    const token = randomBytes(32).toString("base64url");
    await db.$transaction([
      db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } }),
      db.session.create({
        data: {
          digest: digest(token),
          userId,
          expiresAt: new Date(Date.now() + sessionSeconds * 1000),
        },
      }),
    ]);
    const headers = {
      "Set-Cookie": sessionCookie(token),
      "Cache-Control": "no-store",
    };
    if (
      req.headers
        .get("content-type")
        ?.startsWith("application/x-www-form-urlencoded")
    )
      return new Response(null, {
        status: 303,
        headers: { ...headers, Location: "/" },
      });
    return Response.json(
      { user: { id: userId, email } },
      {
        status: signup ? 201 : 200,
        headers,
      },
    );
  } catch (e) {
    return failure(e);
  }
}
