import { HttpError } from "./access";
export type AppRoute = { path: string; methods: string[] };
export function appRoutes(
  files: Record<string, string>,
  instant: boolean,
): AppRoute[] {
  if (instant) {
    let schema;
    try {
      schema = JSON.parse(files["forge.schema.json"] || "{}");
    } catch {
      return [];
    }
    return Object.keys(schema.tables || {})
      .filter((key) => /^[\w-]+$/.test(key))
      .flatMap((table) => [
        { path: "/api/data/" + table, methods: ["GET", "POST"] },
        {
          path: "/api/data/" + table + "/[id]",
          methods: ["GET", "PATCH", "PUT", "DELETE"],
        },
      ]);
  }
  const routes: AppRoute[] = [];
  for (const [name, source] of Object.entries(files)) {
    const route = /^(?:src\/)?app\/(api\/.+?)\/route\.(?:[cm]?[jt]s)$/.exec(
      name,
    );
    if (!route) continue;
    const path =
      "/" +
      route[1]
        .split("/")
        .filter((s) => !s.startsWith("(") && !s.startsWith("@"))
        .join("/");
    const methods = Array.from(
      new Set(
        Array.from(
          source.matchAll(
            /\bexport\s+(?:(?:async\s+)?function\s+|(?:const|let)\s+)(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b/g,
          ),
          (m) => m[1],
        ),
      ),
    );
    if (methods.length) routes.push({ path, methods });
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}
export function checkProbe(routes: AppRoute[], method: string, path: string) {
  if (
    !/^\/api\/[A-Za-z0-9_\-/]*(?:\?[A-Za-z0-9%_=&+.,:~/-]*)?$/.test(path) ||
    path.includes("//") ||
    path.length > 1000
  )
    throw new HttpError(400, "Enter a project API path.");
  const segments = path.split("?")[0].split("/");
  const match = routes.some((route) => {
    if (!route.methods.includes(method)) return false;
    const parts = route.path.split("/");
    return (
      parts.length === segments.length &&
      parts.every(
        (part, i) =>
          part === segments[i] ||
          (/^\[\w+\]$/.test(part) && /^[\w-]+$/.test(segments[i])),
      )
    );
  });
  if (!match)
    throw new HttpError(
      400,
      "Choose a method and route defined in this project.",
    );
}
