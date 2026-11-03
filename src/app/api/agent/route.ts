import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { authorize, readJson, HttpError, failure } from "@/lib/access";
import { brief } from "@/lib/validation";
import { requestProviders } from "@/lib/providers";
import { modelAccess, runAgent } from "@/lib/agent-runner";
import type { Event, Worker } from "@/lib/engine";
import { sandboxMode, newSandbox, retireSandbox } from "@/lib/sandbox-manager";
import { blueprintSchema, planApplication } from "@/lib/blueprint";
import { instantInstructions, instantStarter } from "@/lib/instant-worker";
import { engineerPrompt } from "@/lib/prompt";
import { previewFiles } from "@/lib/inspect-bridge";
import { applicationStarter } from "@/lib/app-starter";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request) {
  try {
    const user = await authorize(req);
    const parsed = brief.safeParse(await readJson(req));
    if (!parsed.success)
      throw new HttpError(
        400,
        "Choose a project and describe the change in 8 to 6000 characters.",
      );
    const config = requestProviders(req);
    if (config.missing.length)
      throw new HttpError(
        400,
        "Choose a configured model or add your provider key in Settings.",
      );
    const { projectId, revision, prompt, engine, mode } = parsed.data;
    const access = modelAccess(config);
    const lease = randomUUID(),
      now = new Date();
    const { project, run, runtime } = await db.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId, ownerId: user.id },
        include: {
          files: true,
          runs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { prompt: true, status: true },
          },
        },
      });
      if (!project) throw new HttpError(404, "Unknown project.");
      const runtime = sandboxMode(
        engine,
        !!config.e2bKey,
        project.sandboxId,
        project.files.map((f) => f.path),
      );
      if (runtime === "cloud" && !config.e2bKey && mode === "build")
        throw new HttpError(400, "Add an E2B key in Settings.");
      if (
        project.revision &&
        project.sandboxId &&
        (runtime === "instant") !== project.sandboxId.startsWith("instant-")
      )
        throw new HttpError(
          409,
          "Use a new project to switch between the built-in app format and a Node VM.",
        );
      if (project.revision !== revision)
        throw new HttpError(409, "Reload the latest revision before editing.");
      const active = await tx.project.count({
        where: { ownerId: user.id, leaseUntil: { gt: now } },
      });
      if (active)
        throw new HttpError(
          409,
          "Another build is in progress in this workspace.",
        );
      await tx.run.updateMany({
        where: {
          status: "building",
          project: { ownerId: user.id, leaseUntil: { lte: now } },
        },
        data: { status: "failed", report: "The build worker timed out." },
      });
      await tx.project.update({
        where: { id: projectId, ownerId: user.id },
        data: { lease, leaseUntil: new Date(+now + 610000) },
      });
      return {
        project,
        runtime,
        run: await tx.run.create({
          data: { projectId, prompt, status: "building" },
        }),
      };
    });
    const cancel = new AbortController();
    const signal = AbortSignal.any([
      req.signal,
      cancel.signal,
      AbortSignal.timeout(570000),
    ]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let box: Awaited<ReturnType<typeof newSandbox>> | undefined;
        let success = false,
          bytes = 0;
        const emit = (event: Event) => {
          if (signal.aborted) return;
          if (
            (event.type === "stdout" || event.type === "stderr") &&
            (bytes += event.text.length) > 300000
          )
            return;
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        try {
          emit({ type: "runtime", mode: runtime });
          const sameBrief =
            (project.runs[0]?.status === "planned" &&
              project.runs[0].prompt === prompt) ||
            prompt === "Build the application described in my saved blueprint.";
          const saved =
            mode === "build" && sameBrief && project.blueprint
              ? blueprintSchema.parse(JSON.parse(project.blueprint))
              : null;
          emit({
            type: "stage",
            text: saved
              ? "Architect: using your saved blueprint"
              : "Architect: planning the data, screens and interface",
          });
          const blueprint =
            saved ||
            (await planApplication(
              access.claude,
              access.model,
              prompt,
              project.blueprint,
              signal,
              (sys, msg, schema) => access.generate(sys, msg, signal, schema),
              runtime === "instant",
            ));
          emit({ type: "blueprint", blueprint });
          if (mode === "plan") {
            await db.$transaction(async (tx) => {
              const claim = await tx.project.updateMany({
                where: { id: projectId, ownerId: user.id, lease, revision },
                data: {
                  blueprint: JSON.stringify(blueprint),
                  lease: null,
                  leaseUntil: null,
                },
              });
              if (!claim.count) throw Error("Plan session expired.");
              await tx.run.update({
                where: { id: run.id },
                data: { status: "planned", report: blueprint.summary },
              });
            });
            emit({ type: "planned" });
            return;
          }
          emit({
            type: "stage",
            text:
              runtime === "instant"
                ? "Builder: opening the built-in engine"
                : runtime === "cloud"
                  ? "Builder: opening an E2B microVM"
                  : "Builder: opening an isolated Docker container",
          });
          box = await newSandbox(
            runtime,
            req,
            projectId,
            config.e2bKey,
            emit,
            signal,
          );
          const worker: Worker = box.worker;
          if (runtime !== "instant")
            worker.preparePreview = async (files) => {
              for (const [name, content] of Object.entries(previewFiles(files)))
                if (content !== files[name]) await worker.write(name, content);
            };
          const files = Object.fromEntries(
            project.files.map((f) => [f.path, f.content]),
          );
          const snapshot = {
            files,
            install: project.install,
            start: project.start,
          };
          const result = await runAgent({
            access,
            start:
              runtime === "instant"
                ? instantStarter(snapshot)
                : applicationStarter(snapshot),
            prompt,
            blueprint,
            instructions:
              runtime === "instant" ? instantInstructions : engineerPrompt,
            worker,
            emit,
            signal,
          });
          signal.throwIfAborted();
          const live = box;
          await db.$transaction(async (tx) => {
            const claim = await tx.project.updateMany({
              where: { id: projectId, ownerId: user.id, lease, revision },
              data: {
                revision: { increment: 1 },
                blueprint: JSON.stringify(blueprint),
                preview: live.url,
                sandboxId: live.id,
                install: result.install,
                start: result.start,
                lease: null,
                leaseUntil: null,
              },
            });
            if (!claim.count) throw Error("Build lease expired.");
            for (const [path, content] of Object.entries(result.files))
              await tx.sourceFile.upsert({
                where: { projectId_path: { projectId, path } },
                update: { content },
                create: { projectId, path, content },
              });
            await tx.run.update({
              where: { id: run.id },
              data: {
                status: "ready",
                report:
                  runtime === "instant"
                    ? "The application compiled and its interactive preview is ready."
                    : "TypeScript and the port 3000 HTTP check passed.",
              },
            });
          });
          success = true;
          await retireSandbox(projectId, project.sandboxId, config.e2bKey);
          emit({ type: "ready", url: live.url, revision: revision + 1 });
        } catch (e) {
          const reason = signal.aborted
            ? "Build stopped or timed out."
            : (e instanceof Error ? e.message : "Build failed.").slice(-6500);
          await db.run
            .update({
              where: { id: run.id },
              data: { status: "failed", report: reason },
            })
            .catch(() => {});
          emit({ type: "error", text: reason });
        } finally {
          await box?.release(success);
          await db.project
            .updateMany({
              where: { id: projectId, ownerId: user.id, lease },
              data: { lease: null, leaseUntil: null },
            })
            .catch(() => {});
          try {
            controller.close();
          } catch {}
        }
      },
      cancel() {
        cancel.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
