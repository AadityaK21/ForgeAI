import { readFileSync } from "node:fs";
import path from "node:path";
import type { Snapshot } from "./engine";
export function template(name: string) {
  return readFileSync(
    path.join(process.cwd(), "src/templates/instant", name),
    "utf8",
  );
}
export function upgradeInstantFiles(files: Record<string, string>) {
  return {
    ...files,
    "runtime/main.tsx": template("main.tsx.txt"),
    "runtime/server.cjs": template("server.cjs"),
    "runtime/store.cjs": template("store.cjs"),
  };
}
export const instantInstructions = [
  "Use the supplied Forge instant full-stack React/TypeScript and SQLite scaffold. It is a different target from Next App Router. Never create Next/Prisma files, dependencies, npm shell commands or start actions for this target. Preserve package.json, runtime/* and tsconfig.json.",
  "Write forge.schema.json first. It is the backend specification: {tables:{leads:{fields:{name:'string',active:'boolean',score:'number'},seed:[]}}}. Use real double-quoted JSON. Table and field names start with a letter and use letters, digits, underscores. Fields support string, boolean or number; omit id from fields. Each record gets a string id. Any seed rows must match field types. Build the data model for this user's business.",
  "Next write src/App.tsx, with a default React component receiving {path}:{path:string}; it must render a complete usable multipage app. Navigate with <a href='#/route'>. Use the implemented SQLite backend, fetch('/api/data/<table>') returns the records array. POST a JSON object to the collection, PATCH/DELETE by /api/data/<table>/<id>. Handle loading, validation, empty states and errors. Never create substitute memory stores. Include types for data and handlers. Do not require authentication, payment secrets, external endpoints or external images for this preview.",
  "Write src/styles.css for responsive original styling. Tailwind 3 is installed; optional imports include React, lucide-react, zod, clsx and tailwind-merge. Import helpers relatively from files in src, or via @/. Do not import CSS in TSX; the compiler loads src/styles.css automatically. Implement the brief using these tools. Use the same action protocol as the builder; a file action is a full file replacement.",
].join("\n");
export function instantStarter(project: Snapshot): Snapshot {
  if (project.files["package.json"])
    return { ...project, files: upgradeInstantFiles(project.files) };
  const manifest = {
    name: "forge-instant-app",
    version: "1.0.0",
    private: true,
    scripts: {
      start: "node runtime/server.cjs",
      dev: "node runtime/server.cjs",
      typecheck: "tsc --noEmit",
    },
    engines: { node: ">=22.13" },
    dependencies: {
      react: "^19.1.0",
      "react-dom": "^19.1.0",
      "lucide-react": "^0.577.0",
      esbuild: "0.28.2",
      postcss: "^8",
      tailwindcss: "3.4.17",
      zod: "^4",
      clsx: "^2",
      "tailwind-merge": "^3",
    },
    devDependencies: {
      typescript: "~5.9.3",
      "@types/react": "^19",
      "@types/react-dom": "^19",
    },
  };
  return {
    files: {
      "package.json": JSON.stringify(manifest, null, 2),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            strict: true,
            jsx: "react-jsx",
            module: "ESNext",
            moduleResolution: "Bundler",
            skipLibCheck: true,
            esModuleInterop: true,
            lib: ["ES2022", "DOM", "DOM.Iterable"],
            paths: { "@/*": ["./src/*"] },
          },
          include: ["src", "runtime/main.tsx"],
        },
        null,
        2,
      ),
      "runtime/main.tsx": template("main.tsx.txt"),
      "runtime/server.cjs": template("server.cjs"),
      "runtime/store.cjs": template("store.cjs"),
      "README.md":
        "# Running this app\n\nUse Node.js 22.13 or later. Run npm install and npm start, then open http://localhost:3000. Records are saved to app.sqlite. Set PORT, HOST or DATABASE_FILE to change the local defaults.\n",
      ...project.files,
    },
    install: "forge verify",
    start: "forge preview",
  };
}
