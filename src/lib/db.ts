import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
const scope = globalThis as typeof globalThis & { merovaDb?: PrismaClient };
export const remoteStorage = () => Boolean(process.env.TURSO_DATABASE_URL);
function client() {
  if (remoteStorage()) {
    return new PrismaClient({ adapter: new PrismaLibSQL({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    }, { timestampFormat: "unixepoch-ms" }), transactionOptions: { maxWait: 10000, timeout: 20000 } });
  }
  if (process.env.VERCEL) throw Error("Configure ForgeAI's own Turso database before deploying.");
  return new PrismaClient();
}
export const db = scope.merovaDb ?? client();
scope.merovaDb = db;
