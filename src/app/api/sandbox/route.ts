import { z } from "zod";
import { POST as build } from "@/app/api/agent/route";
import { authorize, failure, HttpError, readJson } from "@/lib/access";
import { db } from "@/lib/db";
import { brief, newProject } from "@/lib/validation";
import { checkedPath, ownedProject, projectResult } from "@/lib/studio-project";
import { saveRevision } from "@/lib/manual-revision";
export const runtime = "nodejs";
export const maxDuration = 600;
export const dynamic = "force-dynamic";
const editSchema = z
  .object({
    projectId: z.string().min(1).max(100),
    revision: z.number().int().nonnegative(),
    path: z.string().min(1).max(240),
    content: z.string().max(150000),
  })
  .strict();
export async function GET(req: Request) {
  try {
    const user = await authorize(req),
      q = new URL(req.url).searchParams;
    const project = await ownedProject(user.id, q.get("projectId"));
    if (q.has("path")) {
      const file = project.files.find(
        (f) => f.path === checkedPath(q.get("path") || ""),
      );
      if (!file) throw new HttpError(404, "Unknown source file.");
      return Response.json({
        path: file.path,
        content: file.content,
        revision: project.revision,
      });
    }
    return Response.json(await projectResult(project));
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(req: Request) {
  try {
    const user = await authorize(req);
    const input = editSchema.safeParse(await readJson(req, false, 750000));
    if (!input.success)
      throw new HttpError(
        400,
        "Enter a valid file, revision and replacement source.",
      );
    checkedPath(input.data.path);
    return Response.json(await saveRevision(user.id, input.data, req));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const user = await authorize(req),
      input = await readJson(req);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new HttpError(400, "Enter a project brief.");
    const { title, ...fields } = input;
    const create = fields.projectId === undefined;
    const data = brief.safeParse(
      create ? { ...fields, projectId: "new", revision: 0 } : fields,
    );
    if (!data.success)
      throw new HttpError(
        400,
        "Choose a project and supply a valid revision and build brief.",
      );
    let projectId = data.data.projectId;
    if (create) {
      const parsed = newProject.safeParse({
        title: title ?? data.data.prompt.trim().slice(0, 65),
      });
      if (!parsed.success)
        throw new HttpError(
          400,
          "Use a project name between 2 and 80 characters.",
        );
      projectId = (
        await db.project.create({
          data: { ownerId: user.id, ...parsed.data },
          select: { id: true },
        })
      ).id;
    }
    const response = await build(
      new Request(req.url, {
        method: "POST",
        headers: req.headers,
        signal: req.signal,
        body: JSON.stringify({ ...data.data, projectId }),
      }),
    );
    if (!response.ok) {
      const error = await response.json();
      return Response.json(
        { ...error, projectId },
        { status: response.status },
      );
    }
    if (req.headers.get("accept")?.includes("application/x-ndjson"))
      return new Response(response.body, {
        headers: {
          ...Object.fromEntries(response.headers),
          "x-project-id": projectId,
        },
      });
    const reader = response.body!.getReader(),
      decoder = new TextDecoder(),
      buildLogs: string[] = [];
    let buffer = "",
      complete = false;
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === "error")
          return Response.json(
            { projectId, error: event.text, buildLogs },
            { status: 422 },
          );
        if (event.type === "ready" || event.type === "planned") complete = true;
        if (
          ["stdout", "stderr", "stage", "repair"].includes(event.type) &&
          event.text
        ) {
          buildLogs.push(String(event.text).slice(-1200));
          if (buildLogs.length > 100) buildLogs.shift();
        }
      }
      if (chunk.done) break;
    }
    if (!complete)
      return Response.json(
        { projectId, error: "Build ended before it was verified.", buildLogs },
        { status: 502 },
      );
    return Response.json(
      await projectResult(await ownedProject(user.id, projectId), buildLogs),
      { status: create ? 201 : 200 },
    );
  } catch (e) {
    return failure(e);
  }
}
