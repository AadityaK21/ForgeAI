import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { directLocal } from "./providers";
import { Sandbox } from "@e2b/code-interpreter";
import { HttpError } from "./access";
import { safePath } from "./artifact-parser";

export type MountedProject = { id: string; sandboxId: string | null };
type Inspection =
  | { type: "tables"; table?: string }
  | { type: "api"; path: string; method: string; body?: string }
  | { type: "verify" }
  | { type: "write"; path: string; content: string }
  | { type: "ping" };
// This function is serialized and runs inside the owned worker. Inputs are data;
// neither the host shell nor the host network participate in model-generated calls.
const program = String.raw`async function probe(input) {
    const { spawnSync } = require("node:child_process");
    const fs = require("node:fs");
    const path = require("node:path");
    if (input.type === "ping")
        return true;
    if (input.type === "write") {
        const root = fs.realpathSync(".");
        const target = path.resolve(root, input.path);
        if (!target.startsWith(root + path.sep) || fs.realpathSync(path.dirname(target)) !== path.dirname(target))
            throw Error("Invalid sandbox file path.");
        const fd = fs.openSync(target, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
        try {
            const stat = fs.fstatSync(fd);
            if (!stat.isFile() || stat.nlink !== 1)
                throw Error("Unsafe sandbox file.");
            fs.ftruncateSync(fd, 0);
            fs.writeFileSync(fd, input.content, "utf8");
        }
        finally {
            fs.closeSync(fd);
        }
        return true;
    }
    if (input.type === "verify") {
        const out = spawnSync("./node_modules/.bin/tsc", ["--noEmit"], { encoding: "utf8", timeout: 70000, maxBuffer: 1000000 });
        if (out.status !== 0)
            throw Error(String(out.stdout || out.stderr || "TypeScript verification failed.").slice(-4000));
        const page = await fetch("http://127.0.0.1:3000/", { redirect: "manual", signal: AbortSignal.timeout(25000) });
        await page.body?.cancel();
        if (page.status < 200 || page.status >= 400)
            throw Error("Preview returned HTTP " + page.status + ".");
        return true;
    }
    if (input.type === "api") {
        const url = new URL(input.path, "http://127.0.0.1:3000");
        if (url.origin !== "http://127.0.0.1:3000" || !url.pathname.startsWith("/api/"))
            throw Error("Invalid application route.");
        const response = await fetch(url, { method: input.method, body: input.body, headers: input.body === undefined ? {} : { "content-type": "application/json" }, redirect: "manual", signal: AbortSignal.timeout(12000) });
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let bytes = 0, text = "", truncated = false;
        if (reader)
            try {
                while (bytes < 12000) {
                    const r = await reader.read();
                    if (r.done)
                        break;
                    const max = 12000 - bytes;
                    text += decoder.decode(r.value.subarray(0, max), { stream: true });
                    bytes += r.value.length;
                    if (bytes >= 12000) {
                        truncated = true;
                        break;
                    }
                }
                text += decoder.decode();
            }
            finally {
                await reader.cancel().catch(() => { });
            }
        return { status: response.status, body: text, truncated, contentType: response.headers.get("content-type") };
    }
    const { PrismaClient } = require(process.cwd() + "/node_modules/@prisma/client");
    const db = new PrismaClient();
    try {
        const catalog = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%' ORDER BY name LIMIT 100");
        const tables = catalog.map((row) => String(row.name));
        if (!input.table)
            return { tables, rows: [], columns: [] };
        if (!tables.includes(input.table))
            throw Error("Unknown preview table.");
        const identifier = '"' + input.table.replaceAll('"', '""') + '"';
        const described = await db.$queryRawUnsafe("PRAGMA table_info(" + identifier + ")");
        const columns = described.map((row) => row.name).slice(0, 24);
        const select = columns.map((name) => {
            const quoted = '"' + name.replaceAll('"', '""') + '"';
            return /password|secret|token|api.?key|salt/i.test(name) ? "'[hidden]' AS " + quoted : "substr(CAST(" + quoted + " AS TEXT),1,160) AS " + quoted;
        });
        const rows = await db.$queryRawUnsafe("SELECT " + select.join(",") + " FROM " + identifier + " LIMIT 20");
        return { tables, columns, rows };
    }
    finally {
        await db.$disconnect();
    }
}
let input='';process.stdin.on('data',chunk=>input+=chunk).on('end',()=>probe(JSON.parse(input)).then(result=>console.log(JSON.stringify({result}))).catch(error=>console.log(JSON.stringify({error:String(error.message).slice(-4000)}))));`;

export async function inspectWorker(
  project: MountedProject,
  input: Inspection,
  req: Request,
  e2bKey?: string,
) {
  if (!project.sandboxId || !/^[\w-]{1,100}$/.test(project.id))
    throw new HttpError(409, "Build or reopen this preview first.");
  if (input.type === "write") safePath(input.path);
  const payload = JSON.stringify(input);
  const time = input.type === "verify" ? 110000 : 16000;
  let output: string;
  try {
    if (/^local-[a-f0-9-]{36}$/.test(project.sandboxId)) {
      if (!directLocal(req))
        throw new HttpError(
          403,
          "Open the local builder to inspect this preview.",
        );
      const id = project.sandboxId;
      output = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          "docker",
          [
            "exec",
            "-i",
            "-w",
            "/tmp/.sandboxes/" + project.id,
            id,
            "node",
            "-e",
            program,
          ],
          {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            signal: AbortSignal.any([req.signal, AbortSignal.timeout(time)]),
          },
        );
        let text = "",
          over = false;
        child.stdout.on("data", (chunk) => {
          if (!over) {
            text += chunk.toString();
            if (text.length > 160000) {
              over = true;
              child.kill();
            }
          }
        });
        child.stderr.resume();
        child.once("error", reject);
        child.once("close", (code) =>
          code === 0 && !over
            ? resolve(text)
            : reject(Error("Sandbox is offline.")),
        );
        child.stdin.on("error", () => {});
        child.stdin.end(payload);
      });
    } else {
      if (!e2bKey)
        throw new HttpError(
          409,
          "Set the E2B key used to open this cloud preview.",
        );
      if (!/^[A-Za-z0-9-]{5,100}$/.test(project.sandboxId))
        throw new HttpError(409, "Invalid preview ID.");
      const box = await Sandbox.connect(project.sandboxId, { apiKey: e2bKey });
      const quote = (value: string) =>
        "'" + value.replaceAll("'", "'\\''") + "'";
      const requestFile = "/tmp/forge-inspect-" + randomUUID() + ".json";
      await box.files.write(requestFile, payload);
      try {
        const result = await box.commands.run(
          "node -e " + quote(program) + " < " + quote(requestFile),
          { cwd: "/home/user/merova-app", timeoutMs: time },
        );
        output = result.stdout;
      } finally {
        await box.files.remove(requestFile).catch(() => {});
      }
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      410,
      "This preview is unavailable. Run a build to open a fresh sandbox.",
    );
  }
  let value;
  try {
    value = JSON.parse(output.trim());
  } catch {
    throw new HttpError(502, "The preview returned invalid inspection data.");
  }
  if (value.error) throw new HttpError(422, String(value.error));
  return value.result;
}
