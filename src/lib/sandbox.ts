import { safePath } from "./artifact-parser";
import { Sandbox } from "@e2b/code-interpreter";
import type { Event, Worker } from "./engine";
const cwd = "/home/user/merova-app";
export async function createWorker(
  emit: (e: Event) => void,
  signal: AbortSignal,
  apiKey = process.env.E2B_API_KEY,
) {
  const options = {
    apiKey,
    timeoutMs: 15 * 60_000,
    secure: true,
    network: { allowPublicTraffic: true },
  };
  const box = process.env.E2B_TEMPLATE
    ? await Sandbox.create(process.env.E2B_TEMPLATE, options)
    : await Sandbox.create(options);
  let pid: number | undefined,
    tail = "";
  const log = (type: "stdout" | "stderr", s: string) => {
    tail = (tail + s).slice(-5500);
    emit({ type, text: s.slice(-10000) });
  };
  const common = {
    cwd,
    envs: { CI: "1", NEXT_TELEMETRY_DISABLED: "1" },
    onStdout: (s: string) => log("stdout", s),
    onStderr: (s: string) => log("stderr", s),
    retainOutput: false,
  };
  const kill = async () => {
    if (pid !== undefined) await box.commands.kill(pid).catch(() => false);
    pid = undefined;
  };
  const abort = () => {
    void box.kill().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    await box.files.makeDir(cwd);
    const runtime = await box.commands.run('node -p "process.versions.node"', {
      cwd,
    });
    if (Number(runtime.stdout.trim().split(".")[0]) < 20)
      throw Error(
        "The E2B template needs Node 20 or newer. Set E2B_TEMPLATE to a Node 20+ template.",
      );
  } catch (e) {
    signal.removeEventListener("abort", abort);
    await box.kill().catch(() => {});
    throw e;
  }
  const worker: Worker = {
    async read(path) {
      return box.files.read(cwd + "/" + safePath(path));
    },
    async list() {
      const paths: string[] = [];
      const queue = [cwd];
      for (let i = 0; i < queue.length && i < 300; i++) {
        for (const entry of await box.files.list(queue[i])) {
          if (
            entry.symlinkTarget ||
            [".git", "node_modules", ".next"].includes(entry.name)
          )
            continue;
          if (entry.type === "dir" && queue.length < 300)
            queue.push(entry.path);
          if (entry.type === "file" && paths.length < 500)
            paths.push(entry.path.slice(cwd.length + 1));
        }
      }
      return paths;
    },
    async write(path, content) {
      safePath(path);
      signal.throwIfAborted();
      const parent = path.lastIndexOf("/");
      if (parent > 0)
        await box.files.makeDir(cwd + "/" + path.slice(0, parent));
      await box.files.write(cwd + "/" + path, content);
    },
    async run(command) {
      tail = "";
      try {
        await box.commands.run("set -e\n" + command, {
          ...common,
          timeoutMs: 120000,
        });
      } catch (e) {
        throw Error(
          (e instanceof Error ? e.message : "Command failed") + "\n" + tail,
        );
      }
    },
    async start(command) {
      const handle = await box.commands.run(command, {
        ...common,
        background: true,
        timeoutMs: 0,
      });
      pid = handle.pid;
      // Probe inside the sandbox so an arbitrary model-supplied URL can never reach the host network.
      const probe =
        'for i in $(seq 1 35); do code=$(curl --max-time 3 -s -o /tmp/merova-response -w "%{http_code}" http://127.0.0.1:3000/ || true); case "$code" in 2??|3??) exit 0;; esac; sleep 1; done; echo "Port 3000 returned $code"; head -c 700 /tmp/merova-response; exit 1';
      try {
        await box.commands.run(probe, { cwd, timeoutMs: 75000 });
      } catch (e) {
        throw Error(
          "Preview failed the HTTP check. " +
            tail +
            " " +
            (e instanceof Error ? e.message : ""),
        );
      }
    },
    stop: kill,
  };
  return {
    worker,
    id: box.sandboxId,
    url: "https://" + box.getHost(3000),
    release: async (success: boolean) => {
      signal.removeEventListener("abort", abort);
      if (!success) await box.kill().catch(() => {});
    },
  };
}
