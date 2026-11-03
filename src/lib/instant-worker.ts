import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "tailwindcss";
import { INSPECTOR_SCRIPT } from "./inspect-bridge";
import type { Event } from "./engine";
import { containedFile, instantProject, instantId } from "./instant-paths";
import { schemaTables } from "../templates/instant/store.cjs";
import { template } from "./instant-starter";
export { instantStarter, instantInstructions } from "./instant-starter";
const modules = new Set([
  "react",
  "react/jsx-runtime",
  "react-dom/client",
  "lucide-react",
  "clsx",
  "tailwind-merge",
  "zod",
]);
export const instantCsp =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src data:; media-src data: blob:; frame-src 'none'; form-action 'none'; base-uri 'none'";
const bridge = `
window.fetch=async(input,init={})=>{
 const request=new Request(new URL(typeof input==='string'?input:input.url||input,'https://forge.invalid'),init);
 const u=new URL(request.url);
 if(u.origin!=='https://forge.invalid'||!u.pathname.startsWith('/api/data/'))throw Error('Only project data endpoints run in the instant preview.');
 const id=crypto.randomUUID(), method=request.method;
 const body=['GET','HEAD','DELETE'].includes(method)?undefined:await request.json();
 return new Promise((resolve,reject)=>{
  function cleanup(){clearTimeout(timer);window.removeEventListener('message',receive);}
  function receive(e){const m=e.data;if(e.source!==parent||m?.kind!=='forge-data-result'||m.id!==id)return;cleanup();resolve(new Response(JSON.stringify(m.body),{status:m.status,headers:{'Content-Type':'application/json'}}));}
  const timer=setTimeout(()=>{cleanup();reject(Error('Workspace data request timed out.'));},15000);
  window.addEventListener('message',receive);parent.postMessage({kind:'forge-data',id,method,path:u.pathname,body},'*');
 });
};
`;
function typecheck(files: Record<string, string>, dir: string) {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    types: [],
    baseUrl: dir,
    paths: { "@/*": ["src/*"] },
  };
  const host = ts.createCompilerHost(options);
  const deps = path.resolve(process.cwd(), "node_modules") + path.sep;
  const sources = new Set(Object.keys(files).map((p) => path.resolve(dir, p)));
  const allowed = (p: string) =>
    sources.has(path.resolve(p)) || path.resolve(p).startsWith(deps);
  const read = host.readFile,
    exists = host.fileExists;
  host.readFile = (p) => (allowed(p) ? read(p) : undefined);
  host.fileExists = (p) => allowed(p) && exists(p);
  host.getSourceFile = (name, language) => {
    const content = host.readFile(name);
    return content === undefined
      ? undefined
      : ts.createSourceFile(name, content, language, true);
  };
  const check = ts.createProgram(
    Object.keys(files)
      .filter((p) => /\.[tj]sx?$/.test(p) && !p.endsWith(".js"))
      .map((p) => path.resolve(dir, p)),
    options,
    host,
  );
  const errors = ts
    .getPreEmitDiagnostics(check)
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .slice(0, 8);
  if (errors.length)
    throw Error(
      errors
        .map((d) => {
          const loc = d.file?.getLineAndCharacterOfPosition(d.start || 0);
          return (
            (d.file
              ? path.relative(dir, d.file.fileName) +
                ":" +
                ((loc?.line || 0) + 1) +
                " "
              : "") +
            "TS" +
            d.code +
            " " +
            ts.flattenDiagnosticMessageText(d.messageText, "\n")
          );
        })
        .join("\n"),
    );
}
function escapeScript(text: string) {
  return text.replace(/<\/script/gi, "<\\/script");
}
async function compile(files: Record<string, string>, dir: string) {
  if (!files["src/App.tsx"] || !files["forge.schema.json"])
    throw Error(
      "Generate forge.schema.json and a default React component in src/App.tsx.",
    );
  schemaTables(JSON.parse(files["forge.schema.json"]));
  const protectedFiles = {
    "runtime/main.tsx": "main.tsx.txt",
    "runtime/store.cjs": "store.cjs",
    "runtime/server.cjs": "server.cjs",
  };
  for (const [name, filename] of Object.entries(protectedFiles))
    if (
      files[name]?.replace(/\r\n/g, "\n") !==
      template(filename).replace(/\r\n/g, "\n")
    )
      throw Error(
        "Preserve the portable runtime file " +
          name +
          ". Put app logic in src/.",
      );
  typecheck(files, dir);
  const result = await build({
    entryPoints: ["runtime/main.tsx"],
    absWorkingDir: process.cwd(),
    bundle: true,
    write: false,
    jsx: "automatic",
    minify: true,
    platform: "browser",
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "project-files",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === "entry-point")
              return { path: args.path, namespace: "project" };
            if (args.namespace !== "project") return;
            if (modules.has(args.path))
              return b.resolve(args.path, {
                kind: args.kind,
                resolveDir: process.cwd(),
              });
            const resolved = args.path.startsWith("@/")
              ? "src/" + args.path.slice(2)
              : args.path.startsWith(".")
                ? path.posix.normalize(
                    path.posix.join(
                      path.posix.dirname(args.importer),
                      args.path,
                    ),
                  )
                : "";
            if (!resolved || resolved.startsWith("../"))
              throw Error("Unsupported import: " + args.path);
            const match = [
              resolved,
              ...[
                ".ts",
                ".tsx",
                ".js",
                ".jsx",
                "/index.ts",
                "/index.tsx",
                ".json",
              ].map((ext) => resolved + ext),
            ].find((p) => Object.hasOwn(files, p));
            if (!match) throw Error("Missing project module: " + args.path);
            return { path: match, namespace: "project" };
          });
          b.onLoad({ filter: /.*/, namespace: "project" }, (args) => ({
            contents: files[args.path],
            loader: args.path.endsWith(".json")
              ? "json"
              : args.path.endsWith(".ts")
                ? "ts"
                : "tsx",
          }));
        },
      },
    ],
  });
  const css = await postcss([
    tailwind({
      content: Object.entries(files)
        .filter(([p]) => p.endsWith(".tsx"))
        .map(([, raw]) => ({ raw, extension: "tsx" })),
      theme: { extend: {} },
      plugins: [],
    }),
  ]).process(
    "@tailwind base;@tailwind components;@tailwind utilities;\n" +
      (files["src/styles.css"] || ""),
    { from: undefined },
  );
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
    instantCsp +
    '"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
    css.css.replace(/<\/style/gi, "<\\/style") +
    '</style></head><body><div id="root"></div><script>' +
    escapeScript(bridge + INSPECTOR_SCRIPT) +
    "</script><script>" +
    escapeScript(result.outputFiles[0].text) +
    "</script></body></html>"
  );
}
export async function readInstantHtml(projectId: string, id: string) {
  const root = await instantProject(projectId);
  return fs.readFile(
    await containedFile(root, instantId(id) + "/preview.html"),
    "utf8",
  );
}
export async function destroyInstant(projectId: string, id: string) {
  const root = await instantProject(projectId);
  const dest = path.join(root, instantId(id));
  const dir = await fs.lstat(dest).catch(() => null);
  if (dir?.isDirectory() && (await fs.realpath(dest)) === dest)
    await fs.rm(dest, { recursive: true, force: true });
}
export async function createInstantWorker(
  projectId: string,
  emit: (e: Event) => void,
  signal: AbortSignal,
) {
  const root = await instantProject(projectId),
    id = "instant-" + randomUUID(),
    files: Record<string, string> = Object.create(null);
  const preview = await containedFile(root, id + "/preview.html"),
    dir = path.join(root, id, "source");
  await fs.mkdir(dir, { mode: 0o700 });
  let compiled = false;
  async function verify() {
    signal.throwIfAborted();
    emit({
      type: "stage",
      text: "Verifying TypeScript, data schema and browser bundle",
    });
    const html = await compile(files, dir);
    signal.throwIfAborted();
    await fs.writeFile(preview, html, { mode: 0o600 });
    compiled = true;
  }
  const worker = {
    async write(name: string, content: string) {
      signal.throwIfAborted();
      const file = await containedFile(dir, name);
      if (
        (Object.keys(files).length >= 120 && !Object.hasOwn(files, name)) ||
        content.length > 150000
      )
        throw Error("Project file limit exceeded.");
      await fs.writeFile(file, content, { mode: 0o600 });
      files[name] = content;
      compiled = false;
    },
    async read(name: string) {
      if (!Object.hasOwn(files, name)) throw Error("Unknown project file.");
      return fs.readFile(await containedFile(dir, name), "utf8");
    },
    async list() {
      return Object.keys(files).sort();
    },
    async run(command: string) {
      if (command !== "forge verify")
        throw Error(
          "Use the built-in verifier. Arbitrary shell commands need an isolated Linux sandbox.",
        );
      await verify();
    },
    async start(command: string) {
      if (command !== "forge preview")
        throw Error("Use forge preview for an instant application.");
      if (!compiled) await verify();
    },
    async stop() {},
    verify,
  };
  return {
    worker,
    id,
    url:
      "/api/instant/preview?" +
      new URLSearchParams({ projectId, sandboxId: id }),
    release: async (success: boolean) => {
      if (!success) await destroyInstant(projectId, id);
    },
  };
}
