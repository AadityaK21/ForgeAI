import path from "node:path";
import { readFile } from "node:fs/promises";
export const runtime = "nodejs";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ asset: string[] }> },
) {
  const { asset } = await params;
  if (
    !asset.length ||
    asset.some((x) => !/^[-\w.]+$/.test(x) || x.startsWith("."))
  )
    return new Response(null, { status: 404 });
  const types: Record<string, string> = {
    ".js": "text/javascript",
    ".css": "text/css",
    ".ttf": "font/ttf",
    ".json": "application/json",
  };
  const type = types[path.extname(asset.at(-1)!)];
  if (!type) return new Response(null, { status: 404 });
  try {
    const data = await readFile(
      path.join(process.cwd(), "node_modules/monaco-editor/min/vs", ...asset),
    );
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
