import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { HttpError } from "./access";

export async function saveEnvironment(
  updates: Record<string, string>,
  directory = process.cwd(),
) {
  const path = resolve(directory, ".env.local");
  const lockPath = path + ".lock";
  const lock = await open(lockPath, "wx", 0o600).catch((e) => {
    if (e.code === "EEXIST")
      throw new HttpError(409, "Settings are being updated. Try again.");
    throw new HttpError(503, "This server cannot write its settings file.");
  });
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    const stat = await lstat(path).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (
      stat &&
      (!stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > 200000)
    )
      throw new HttpError(
        409,
        "The local settings file cannot be updated safely.",
      );
    const previous = stat ? await readFile(path, "utf8") : "";
    const lines = previous.split(/\r?\n/).filter((line) => {
      const key = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/.exec(line)?.[1];
      return !key || !Object.hasOwn(updates, key);
    });
    while (lines.at(-1) === "") lines.pop();
    for (const [key, value] of Object.entries(updates)) {
      if (
        ![
          "ANTHROPIC_API_KEY",
          "OPENAI_API_KEY",
          "E2B_API_KEY",
          "FORGE_SETTINGS_ADMIN_ID",
        ].includes(key) ||
        !/^[\w.-]{1,512}$/.test(value)
      )
        throw new HttpError(400, "Invalid setting.");
      lines.push(key + "=" + value);
    }
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(lines.join("\n") + "\n", "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      503,
      "This server cannot save .env.local. Use the keys for this tab instead.",
    );
  } finally {
    await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}
