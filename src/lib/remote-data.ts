import { randomUUID } from "node:crypto";
import { db } from "./db";
import { schemaTables, validate } from "../templates/instant/store.cjs";

// All callers first authorize the project owner. Every database key is scoped
// to that project. The write transaction serializes seeding and record limits.
export async function remoteDataRequest(projectId: string, schema: unknown,
  method: string, path: string, body?: unknown): Promise<{status: number; body: unknown}> {
  const tables = schemaTables(schema);
  const match = /^\/api\/data\/([A-Za-z][\w]{0,39})(?:\/([A-Za-z0-9_-]{1,80}))?\/?$/.exec(path.split("?")[0]);
  if (!match || !Object.hasOwn(tables, match[1])) return { status: 404, body: { error: "Unknown collection." } };
  const [, collection, id] = match;
  const table = tables[collection];
  const fail = (status: number, error: string) => ({ status, body: { error } });
  return db.$transaction(async tx => {
    const state = await tx.collectionState.findUnique({ where: { projectId_name: { projectId, name: collection } } });
    if (!state) {
      await tx.collectionState.create({ data: { projectId, name: collection } });
      for (const input of table.seed || []) {
        const seedId = input.id || randomUUID();
        await tx.projectRecord.upsert({
          where: { projectId_collection_id: { projectId, collection, id: seedId } },
          create: { projectId, collection, id: seedId, data: JSON.stringify({ ...input, id: seedId }) }, update: {},
        });
      }
    }
    const one = (key: string) => tx.projectRecord.findUnique({ where: { projectId_collection_id: { projectId, collection, id: key } } });
    if (method === "GET") {
      if (!id) {
        const rows = await tx.projectRecord.findMany({ where: { projectId, collection }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1000 });
        return { status: 200, body: rows.map(row => JSON.parse(row.data)) };
      }
      const row = await one(id);
      return row ? { status: 200, body: JSON.parse(row.data) } : fail(404, "Record not found.");
    }
    if (method === "DELETE" && id) {
      const removed = await tx.projectRecord.deleteMany({ where: { projectId, collection, id } });
      return removed.count ? { status: 200, body: { id } } : fail(404, "Record not found.");
    }
    if (!(method === "POST" && !id || ["PUT", "PATCH"].includes(method) && id)) return fail(405, "Unsupported method.");
    try { validate(table, body); }
    catch (error) { return fail(400, error instanceof Error ? error.message : "Invalid record."); }
    const input = body as Record<string, unknown>;
    const uid = id || input.id as string || randomUUID();
    if (input.id && input.id !== uid) return fail(400, "Record ID differs from URL.");
    const old = await one(uid);
    if (method === "POST" && (old || await tx.projectRecord.count({ where: { projectId, collection } }) >= 1000))
      return fail(409, "Duplicate record or collection is full.");
    if (id && !old) return fail(404, "Record not found.");
    const record = { ...(method === "PATCH" && old ? JSON.parse(old.data) : {}), ...input, id: uid };
    await tx.projectRecord.upsert({
      where: { projectId_collection_id: { projectId, collection, id: uid } },
      create: { projectId, collection, id: uid, data: JSON.stringify(record) }, update: { data: JSON.stringify(record) },
    });
    return { status: id ? 200 : 201, body: record };
  }, { timeout: 15000 });
}
