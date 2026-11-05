import { db, remoteStorage } from "./db";
import { remoteDataRequest } from "./remote-data";
import { containedFile, instantProject } from "./instant-paths";
import { openStore, schemaTables } from "../templates/instant/store.cjs";

async function schema(projectId: string) {
  const file = await db.sourceFile.findUnique({
    where: { projectId_path: { projectId, path: "forge.schema.json" } },
  });
  if (!file) throw Error("No published data schema.");
  return JSON.parse(file.content);
}
export async function listInstantTables(projectId: string) {
  return Object.keys(schemaTables(await schema(projectId)));
}
export async function instantDataRequest(
  projectId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  if (remoteStorage()) return remoteDataRequest(projectId, await schema(projectId), method, path, body);
  const filename = await containedFile(
    await instantProject(projectId),
    "records.sqlite",
  );
  const store = openStore(filename, await schema(projectId));
  try {
    return store.request(method, path, body);
  } finally {
    store.close();
  }
}
export async function readInstantRows(
  projectId: string,
  table: string,
): Promise<Record<string, unknown>[]> {
  const result = await instantDataRequest(
    projectId,
    "GET",
    "/api/data/" + table,
  );
  if (result.status !== 200 || !Array.isArray(result.body))
    throw Error("Unknown data table.");
  return result.body;
}
