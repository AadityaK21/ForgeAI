import { mkdir, open, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function hostedConfig(env = process.env) {
  const directory = env.FORGE_DATA_DIR?.trim();
  if (!directory || !path.isAbsolute(directory))
    throw Error("Set FORGE_DATA_DIR to an absolute directory on a persistent disk.");
  if ((env.BUILDER_ACCESS_TOKEN?.trim().length || 0) < 32)
    throw Error("Set BUILDER_ACCESS_TOKEN to a random invitation code of at least 32 characters.");
  const port = env.PORT || "3000";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw Error("PORT must be between 1 and 65535.");
  const origin = new URL(env.FORGE_PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || "http://localhost:3000");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((!loopback && origin.protocol !== "https:") || !["http:", "https:"].includes(origin.protocol)
    || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
    throw Error("FORGE_PUBLIC_ORIGIN must be the HTTPS origin of this app.");
  if (!env.FORGE_PUBLIC_ORIGIN && !env.RENDER_EXTERNAL_URL)
    throw Error("Set FORGE_PUBLIC_ORIGIN to the hosted app's HTTPS origin.");
  const url = env.DATABASE_URL || "file:" + path.join(directory, "workspace.db").replaceAll("\\", "/");
  if (!url.startsWith("file:") || !path.isAbsolute(url.slice(5)) || /[?#]/.test(url))
    throw Error("DATABASE_URL must identify an absolute SQLite file inside FORGE_DATA_DIR.");
  const database = path.resolve(url.slice(5));
  const relative = path.relative(directory, database);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    throw Error("The workspace database must be inside FORGE_DATA_DIR.");
  return { directory: path.resolve(directory), database, port, origin: origin.origin };
}

/** @returns {Promise<NodeJS.ProcessEnv & { FORGE_DATA_DIR: string, DATABASE_URL: string, FORGE_PUBLIC_ORIGIN: string, PORT: string }>} */
export async function prepareHosted(env = process.env) {
  const config = hostedConfig(env);
  await mkdir(config.directory, { recursive: true, mode: 0o700 });
  const directory = await realpath(config.directory);
  await mkdir(path.dirname(config.database), { recursive: true, mode: 0o700 });
  const parent = await realpath(path.dirname(config.database));
  const relative = path.relative(directory, parent);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    throw Error("The database directory resolves outside the persistent disk.");
  const handle = await open(config.database, "a", 0o600);
  await handle.close();
  const database = await realpath(config.database);
  const location = path.relative(directory, database);
  if (!location || location === ".." || location.startsWith(".." + path.sep) || path.isAbsolute(location))
    throw Error("The database resolves outside the persistent disk.");
  return {
    ...env, NODE_ENV: "production", FORGE_DATA_DIR: directory,
    DATABASE_URL: "file:" + database.replaceAll("\\", "/"),
    FORGE_PUBLIC_ORIGIN: config.origin, PORT: config.port,
  };
}

export async function startHosted() {
  process.umask(0o077);
  const env = await prepareHosted();
  let child;
  function forward(signal) { child?.kill(signal); }
  const onTerm = () => forward("SIGTERM"), onInterrupt = () => forward("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInterrupt);
  function run(args) {
    return new Promise((resolve, reject) => {
      child = spawn(process.execPath, args, { env, stdio: "inherit", shell: false });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(Error(signal ? "Server stopped by " + signal : "Server command exited with code " + code));
      });
    });
  }
  try {
    // Persistent disks are attached at runtime, so migrations run here, not
    // during an isolated build step. No destructive flags.
    await run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
    await run(["node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", env.PORT]);
  } finally {
    process.off("SIGTERM", onTerm);
    process.off("SIGINT", onInterrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startHosted().catch(error => {
    console.error("ForgeAI startup failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  });
}
