import { PrismaClient } from "@prisma/client";
const scope = globalThis as typeof globalThis & { merovaDb?: PrismaClient };
export const db = scope.merovaDb ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") scope.merovaDb = db;
