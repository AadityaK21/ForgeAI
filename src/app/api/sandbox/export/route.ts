import { authorize, failure } from "@/lib/access";
import { ownedProject, fileMap } from "@/lib/studio-project";
import { projectZip } from "@/lib/project-review";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const user = await authorize(req);
    const project = await ownedProject(
      user.id,
      new URL(req.url).searchParams.get("projectId"),
    );
    const archive = await projectZip(fileMap(project));
    const name =
      project.title.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 70) ||
      "forge-project";
    return new Response(new Uint8Array(archive), {
      headers: {
        "content-type": "application/zip",
        "content-disposition":
          'attachment; filename="' + name + "-r" + project.revision + '.zip"',
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
