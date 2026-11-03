import { db } from "./db";
import { HttpError } from "./access";
import { safePath } from "./artifact-parser";
import { reviewSources } from "./project-review";
import { readInstantHtml } from "./instant-worker";
export async function ownedProject(ownerId: string, projectId: string | null) {
  if (!projectId || projectId.length > 100)
    throw new HttpError(400, "Choose a project.");
  const project = await db.project.findFirst({
    where: { id: projectId, ownerId },
    include: { files: { orderBy: { path: "asc" } } },
  });
  if (!project) throw new HttpError(404, "Unknown project.");
  return project;
}
export type StudioProject = Awaited<ReturnType<typeof ownedProject>>;
export function fileMap(project: StudioProject): Record<string, string> {
  return Object.fromEntries(
    project.files.map((file) => [file.path, file.content]),
  );
}
export function checkedPath(path: string) {
  try {
    return safePath(path);
  } catch {
    throw new HttpError(400, "Invalid source file path.");
  }
}
export async function projectResult(
  project: StudioProject,
  buildLogs: string[] = [],
) {
  const files = fileMap(project);
  const instant = project.sandboxId?.startsWith("instant-");
  return {
    projectId: project.id,
    revision: project.revision,
    sandboxId: project.sandboxId,
    mode: instant
      ? "instant"
      : project.sandboxId?.startsWith("local-")
        ? "docker"
        : project.sandboxId
          ? "e2b"
          : null,
    blueprint: project.blueprint ? JSON.parse(project.blueprint) : null,
    fileTree: Object.keys(files),
    files,
    buildLogs,
    securityAudit: reviewSources(files),
    previewUrl: project.preview,
    previewHtml:
      instant && project.sandboxId
        ? await readInstantHtml(project.id, project.sandboxId)
        : null,
  };
}
export { appRoutes, checkProbe, type AppRoute } from "./project-api";
