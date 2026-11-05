import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function migrateTurso(env = process.env) {
  if (!env.TURSO_DATABASE_URL) throw Error("Set TURSO_DATABASE_URL for ForgeAI's dedicated database.");
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  try {
    await db.execute('CREATE TABLE IF NOT EXISTS "_forge_migrations" ("name" TEXT PRIMARY KEY, "checksum" TEXT NOT NULL)');
    const root = path.resolve("prisma/migrations");
    const names = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    for (const name of names) {
      const sql = await readFile(path.join(root, name, "migration.sql"), "utf8");
      const checksum = createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
      const tx = await db.transaction("write");
      try {
        const prior = await tx.execute({ sql: 'SELECT "checksum" FROM "_forge_migrations" WHERE "name" = ?', args: [name] });
        if (prior.rows.length) {
          if (prior.rows[0].checksum !== checksum) throw Error("Applied migration changed: " + name);
        } else {
          await tx.executeMultiple(sql);
          await tx.execute({ sql: 'INSERT INTO "_forge_migrations" ("name", "checksum") VALUES (?, ?)', args: [name, checksum] });
        }
        await tx.commit();
      } catch (error) {
        if (!tx.closed) await tx.rollback();
        throw error;
      } finally { tx.close(); }
    }
    console.log("ForgeAI database migrations verified.");
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  migrateTurso().catch(() => {
    console.error("Database migration failed. Check ForgeAI's database credentials and migration history. No reset was attempted.");
    process.exitCode = 1;
  });
}
