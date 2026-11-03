import { open, readFile, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const schemaDir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(schemaDir, "../.env");
try {
  await copyFile(resolve(schemaDir, "../.env.example"), envPath, 1);
} catch (e) {
  if (e.code !== "EEXIST") throw e;
}
const text = await readFile(envPath, "utf8");
const url =
  process.env.DATABASE_URL ||
  /^DATABASE_URL=["']?([^"'\r\n]+)/m.exec(text)?.[1];
if (!url?.startsWith("file:"))
  throw Error("Set DATABASE_URL to a SQLite file URL.");
const file = resolve(schemaDir, url.slice(5));
const handle = await open(file, "a");
await handle.close();
