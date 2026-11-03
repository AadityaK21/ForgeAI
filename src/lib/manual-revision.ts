import { randomUUID } from "node:crypto";
import { db } from "./db";
import { HttpError } from "./access";
import { fileMap, ownedProject } from "./studio-project";
import { inspectWorker } from "./sandbox-inspection";
import { newSandbox, retireSandbox } from "./sandbox-manager";
import { upgradeInstantFiles } from "./instant-starter";
import { previewFiles } from "./inspect-bridge";
import { directLocal, requestProviders } from "./providers";

type Edit = {
  projectId: string;
  revision: number;
  path: string;
  content: string;
};
export async function saveRevision(owner: string, edit: Edit, req: Request) {
  const project = await ownedProject(owner, edit.projectId);
  if (project.revision !== edit.revision)
    throw new HttpError(
      409,
      "This revision has changed. Reopen the current file.",
    );
  const files = fileMap(project);
  if (!Object.hasOwn(files, edit.path))
    throw new HttpError(404, "Unknown source file.");
  if (!project.sandboxId)
    throw new HttpError(
      409,
      "Build this project once before editing its verified source.",
    );
  const id = project.sandboxId,
    instant = id.startsWith("instant-"),
    local = id.startsWith("local-");
  if (
    instant &&
    ["runtime/main.tsx", "runtime/server.cjs", "runtime/store.cjs"].includes(
      edit.path,
    )
  )
    throw new HttpError(
      422,
      "ForgeAI maintains this runtime file. Edit src/App.tsx, your styles or forge.schema.json to change the app.",
    );
  if (local && !directLocal(req))
    throw new HttpError(403, "Open the local builder to change this preview.");
  const key = (await requestProviders(req)).e2bKey;
  if (!instant && !local && !key)
    throw new HttpError(409, "Set the E2B key used for this cloud preview.");
  const lease = randomUUID(),
    now = new Date(),
    logs: string[] = [];
  const claim = await db.$transaction(async (tx) => {
    if (
      await tx.project.count({
        where: { ownerId: owner, leaseUntil: { gt: now } },
      })
    ) {
      throw new HttpError(409, "Another build is running in this workspace.");
    }
    return tx.project.updateMany({
      where: {
        id: project.id,
        ownerId: owner,
        revision: edit.revision,
        OR: [{ lease: null }, { leaseUntil: { lte: now } }],
      },
      data: { lease, leaseUntil: new Date(+now + 590000) },
    });
  });
  if (!claim.count)
    throw new HttpError(
      409,
      "Another build is running, or the project has changed.",
    );
  const runId = randomUUID(),
    prior = files[edit.path];
  let rollbackLive = false,
    committed = false;
  let fresh:
    | { id: string; url: string; release: (success: boolean) => Promise<void> }
    | undefined;
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(550000)]);
  try {
    await db.run.create({
      data: {
        id: runId,
        projectId: project.id,
        prompt: "Edit " + edit.path,
        status: "building",
      },
    });
    const edited = {
      ...(instant ? upgradeInstantFiles(files) : files),
      [edit.path]: edit.content,
    };
    const hotFile =
      /^(?:src\/|app\/|pages\/|components\/|public\/)[\w./()[\]@+-]+\.(?:[cm]?[jt]sx?|css|scss|json|svg|html)$/.test(
        edit.path,
      );
    let hot = hotFile && !instant;
    if (hot) {
      try {
        await inspectWorker(project, { type: "ping" }, req, key);
      } catch (e) {
        if (e instanceof HttpError && e.status === 410) hot = false;
        else throw e;
      }
    }
    if (hot) {
      rollbackLive = true;
      await inspectWorker(
        project,
        {
          type: "write",
          path: edit.path,
          content: previewFiles(edited)[edit.path],
        },
        req,
        key,
      );
      await inspectWorker(project, { type: "verify" }, req, key);
      logs.push("Verified TypeScript and the live page after hot reload.");
    } else {
      const capture = (event: { type: string; text?: string }) => {
        if (event.text && logs.join("").length < 24000)
          logs.push(event.text.slice(-2000));
      };
      const next = await newSandbox(
        instant ? "instant" : local ? "local" : "cloud",
        req,
        project.id,
        key,
        capture,
        signal,
      );
      fresh = next;
      const code = instant ? edited : previewFiles(edited);
      for (const [path, content] of Object.entries(code)) {
        signal.throwIfAborted();
        await next.worker.write(path, content);
      }
      if (instant) {
        await next.worker.run("forge verify");
        await next.worker.start("forge preview");
      } else {
        if (!project.install || !project.start)
          throw new HttpError(
            409,
            "Run a fresh build to restore the project setup commands.",
          );
        await next.worker.run(project.install);
        await next.worker.run(
          "test -x node_modules/.bin/tsc && npx --no-install tsc --noEmit",
        );
        await next.worker.start(project.start);
      }
      logs.push("Rebuilt the edited project and checked its preview.");
    }
    signal.throwIfAborted();
    await db.$transaction(async (tx) => {
      const changed = await tx.project.updateMany({
        where: {
          id: project.id,
          ownerId: owner,
          revision: edit.revision,
          lease,
        },
        data: {
          lease: null,
          leaseUntil: null,
          revision: { increment: 1 },
          ...(fresh ? { sandboxId: fresh.id, preview: fresh.url } : {}),
        },
      });
      if (!changed.count)
        throw new HttpError(409, "The build lease has expired.");
      for (const [path, content] of Object.entries(edited)) {
        if (content === files[path]) continue;
        await tx.sourceFile.upsert({
          where: { projectId_path: { projectId: project.id, path } },
          create: { projectId: project.id, path, content },
          update: { content },
        });
      }
      await tx.run.update({
        where: { id: runId },
        data: { status: "ready", report: logs.join("\n").slice(-6500) },
      });
    });
    committed = true;
    if (fresh && id !== fresh.id) {
      await retireSandbox(project.id, id, key).catch(() => {});
    }
    return {
      revision: edit.revision + 1,
      buildLogs: logs,
      previewUrl: fresh?.url ?? project.preview,
    };
  } catch (error) {
    const stillOwner = await db.project.count({
      where: { id: project.id, ownerId: owner, lease },
    });
    if (rollbackLive && !committed && stillOwner) {
      const undo = new Request(req.url, { headers: req.headers });
      try {
        await inspectWorker(
          project,
          {
            type: "write",
            path: edit.path,
            content: previewFiles({ ...files, [edit.path]: prior })[edit.path],
          },
          undo,
          key,
        );
      } catch {
        await db.project.updateMany({
          where: { id: project.id, lease },
          data: { preview: null },
        });
      }
    }
    const detail =
      error instanceof Error
        ? error.message.slice(-4000)
        : "The edit did not compile.";
    await db.run
      .updateMany({
        where: { id: runId },
        data: { status: "failed", report: detail },
      })
      .catch(() => {});
    throw error instanceof HttpError ? error : new HttpError(422, detail);
  } finally {
    await fresh?.release(committed).catch(() => {});
    await db.project
      .updateMany({
        where: { id: project.id, ownerId: owner, lease },
        data: { lease: null, leaseUntil: null },
      })
      .catch(() => {});
  }
}
