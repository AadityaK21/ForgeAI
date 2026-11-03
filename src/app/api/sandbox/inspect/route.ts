import { z } from "zod";
import { authorize, failure, HttpError, readJson } from "@/lib/access";
import {
  appRoutes,
  checkProbe,
  fileMap,
  ownedProject,
} from "@/lib/studio-project";
import { inspectWorker } from "@/lib/sandbox-inspection";
import { requestProviders } from "@/lib/providers";
import {
  instantDataRequest,
  listInstantTables,
  readInstantRows,
} from "@/lib/instant-data";
export const dynamic = "force-dynamic";
const requestSchema = z
  .object({
    projectId: z.string().min(1).max(100),
    path: z.string().max(1000),
    method: z.enum([
      "GET",
      "POST",
      "PATCH",
      "PUT",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ]),
    body: z.string().max(9000).optional(),
  })
  .strict();
export async function GET(req: Request) {
  try {
    const user = await authorize(req),
      params = new URL(req.url).searchParams;
    const project = await ownedProject(user.id, params.get("projectId"));
    const instant = !!project.sandboxId?.startsWith("instant-");
    const routes = appRoutes(fileMap(project), instant),
      table = params.get("table") || undefined;
    if (!project.sandboxId)
      return Response.json({
        routes,
        tables: [],
        columns: [],
        rows: [],
        live: false,
      });
    if (instant) {
      const tables = await listInstantTables(project.id);
      if (table && !tables.includes(table))
        throw new HttpError(400, "Choose a table from this project.");
      const raw = table
        ? (await readInstantRows(project.id, table)).slice(0, 20)
        : [];
      const schema = JSON.parse(fileMap(project)["forge.schema.json"] || "{}");
      const columns = table
        ? Array.from(
            new Set([
              "id",
              ...Object.keys(schema.tables?.[table]?.fields || {}),
              ...Object.keys(raw[0] || {}),
            ]),
          ).slice(0, 24)
        : [];
      const rows = raw.map((row) =>
        Object.fromEntries(
          columns.map((key) => [
            key,
            /password|secret|token|api.?key|salt/i.test(key)
              ? "[hidden]"
              : String(row[key] ?? "").slice(0, 160),
          ]),
        ),
      );
      return Response.json({ routes, tables, columns, rows, live: true });
    }
    if (
      !project.files.some(
        (f) =>
          f.path === "prisma/schema.prisma" &&
          /provider\s*=\s*"sqlite"/.test(f.content),
      )
    ) {
      return Response.json({
        routes,
        tables: [],
        columns: [],
        rows: [],
        live: true,
        info: "This preview has no Prisma SQLite tables.",
      });
    }
    const data = await inspectWorker(
      project,
      { type: "tables", table },
      req,
      (await requestProviders(req)).e2bKey,
    );
    return Response.json({ ...data, routes, live: true });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const user = await authorize(req),
      parsed = requestSchema.safeParse(await readJson(req));
    if (!parsed.success)
      throw new HttpError(400, "Choose a valid project API request.");
    const { projectId, path, method, body } = parsed.data,
      project = await ownedProject(user.id, projectId);
    const instant = !!project.sandboxId?.startsWith("instant-");
    if (!project.sandboxId)
      throw new HttpError(409, "Build a preview before sending a request.");
    checkProbe(appRoutes(fileMap(project), instant), method, path);
    let payload;
    if (body !== undefined) {
      if (["GET", "HEAD"].includes(method))
        throw new HttpError(400, "This method does not accept a body.");
      try {
        payload = JSON.parse(body);
      } catch {
        throw new HttpError(400, "Enter valid JSON for the request body.");
      }
    }
    if (instant) {
      const response = await instantDataRequest(
        project.id,
        method,
        path,
        payload,
      );
      return Response.json({
        status: response.status,
        body: JSON.stringify(response.body, null, 2),
        contentType: "application/json",
        truncated: false,
      });
    }
    return Response.json(
      await inspectWorker(
        project,
        { type: "api", path, method, body },
        req,
        (await requestProviders(req)).e2bKey,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
