import { Sandbox } from "@e2b/code-interpreter";
import { createWorker } from "./sandbox";
import {
  createDockerWorker,
  destroyDocker,
  dockerReady,
} from "./docker-worker";
import { createInstantWorker, destroyInstant } from "./instant-worker";
import { directLocal } from "./providers";
import { HttpError } from "./access";
import type { Event } from "./engine";
export type SandboxMode = "cloud" | "local" | "instant";
export function sandboxMode(
  choice: "auto" | SandboxMode,
  hasCloudKey: boolean,
  previous: string | null,
  paths: string[] = [],
): SandboxMode {
  if (choice !== "auto") return choice;
  if (previous?.startsWith("instant-") || paths.includes("forge.schema.json"))
    return "instant";
  if (hasCloudKey) return "cloud";
  if (previous || paths.includes("package.json")) return "local";
  return "instant";
}
export async function newSandbox(
  mode: SandboxMode,
  req: Request,
  projectId: string,
  apiKey: string | undefined,
  emit: (e: Event) => void,
  signal: AbortSignal,
) {
  if (mode === "instant") return createInstantWorker(projectId, emit, signal);
  if (mode === "cloud") {
    if (!apiKey)
      throw new HttpError(400, "Add an E2B key in Settings to use a cloud VM.");
    try {
      return await createWorker(emit, signal, apiKey);
    } catch (e) {
      signal.throwIfAborted();
      if (e instanceof Error && e.message.startsWith("The E2B template needs"))
        throw e;
      throw Error(
        "E2B could not start the cloud sandbox. Check its API key, template and account limits.",
      );
    }
  }
  if (!directLocal(req))
    throw new HttpError(
      403,
      "Open the local builder to run Docker on this machine.",
    );
  if (!(await dockerReady()))
    throw new HttpError(
      503,
      "Start Docker Desktop with Linux containers, or choose the built-in engine for a new project.",
    );
  return createDockerWorker(projectId, emit, signal);
}
export async function retireSandbox(
  projectId: string,
  id: string | null,
  apiKey?: string,
) {
  if (!id) return;
  if (id.startsWith("instant-")) {
    await destroyInstant(projectId, id).catch(() => {});
    return;
  }
  if (id.startsWith("local-")) await destroyDocker(id);
  else if (apiKey) await Sandbox.kill(id, { apiKey }).catch(() => {});
}
