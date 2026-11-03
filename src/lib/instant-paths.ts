import * as fs from "node:fs/promises";
import path from "node:path";
import { safePath } from "./artifact-parser";

export function instantId(id: string) {
  if (!/^instant-[a-f0-9-]{36}$/.test(id))
    throw Error("Invalid instant revision.");
  return id;
}
export async function instantProject(projectId: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(projectId))
    throw Error("Invalid project.");
  const base = await fs.realpath(process.cwd());
  return directories(base, [".sandboxes", projectId]);
}
async function directories(base: string, parts: string[]) {
  let dir = base;
  for (const part of parts) {
    dir = path.join(dir, part);
    await fs.mkdir(dir, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
    if (
      !(await fs.lstat(dir)).isDirectory() ||
      (await fs.realpath(dir)) !== dir
    )
      throw Error("Unsafe workspace directory.");
  }
  return dir;
}
export async function containedFile(base: string, name: string) {
  safePath(name);
  const parts = name.split("/");
  if (
    parts.some(
      (p) =>
        p.endsWith(".") ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
    )
  )
    throw Error("Invalid filename.");
  const dest = path.join(
    await directories(base, parts.slice(0, -1)),
    parts.at(-1)!,
  );
  const entry = await fs.lstat(dest).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  });
  if (entry && (!entry.isFile() || entry.nlink !== 1))
    throw Error("Unsafe workspace file.");
  return dest;
}
