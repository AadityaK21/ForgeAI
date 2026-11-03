import { db } from "@/lib/db";
import { authorize, failure, HttpError, readJson } from "@/lib/access";
import { newProject } from "@/lib/validation";
import { requestProviders } from "@/lib/providers";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const user = await authorize(req);
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const project = await db.project.findUnique({
        where: { id, ownerId: user.id },
        select: {
          id: true,
          title: true,
          revision: true,
          preview: true,
          blueprint: true,
          files: {
            select: { path: true, content: true },
            orderBy: { path: "asc" },
          },
          runs: {
            select: { id: true, prompt: true, status: true, report: true },
            orderBy: { createdAt: "desc" },
            take: 15,
          },
        },
      });
      if (!project) throw new HttpError(404, "Unknown project.");
      return Response.json({
        ...project,
        blueprint: project.blueprint ? JSON.parse(project.blueprint) : null,
      });
    }
    const { missing, modelLabel, available } = requestProviders(req);
    return Response.json({
      projects: await db.project.findMany({
        where: { ownerId: user.id },
        select: { id: true, title: true },
        orderBy: { updatedAt: "desc" },
      }),
      configured: missing.length === 0,
      modelLabel,
      cloudAvailable: available.e2b,
      missing,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const user = await authorize(req);
    const parsed = newProject.safeParse(await readJson(req));
    if (!parsed.success)
      throw new HttpError(
        400,
        "Enter a project title between 2 and 80 characters.",
      );
    return Response.json(
      await db.project.create({
        data: { ...parsed.data, ownerId: user.id },
        select: { id: true, title: true },
      }),
      { status: 201 },
    );
  } catch (e) {
    return failure(e);
  }
}
