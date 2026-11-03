import { ArtifactParser, type ArtifactEvent } from "./artifact-parser";
import type { Blueprint } from "./blueprint";
import ts from "typescript";
import { checkNativeForms } from "./form-contract";
export type Files = Record<string, string>;
export class ProviderFailure extends Error {}
export type Event =
  | ArtifactEvent
  | { type: "blueprint"; blueprint: Blueprint }
  | { type: "planned" }
  | { type: "runtime"; mode: "instant" | "local" | "cloud" }
  | { type: "stage" | "stdout" | "stderr" | "error"; text: string }
  | { type: "repair"; attempt: number; text: string }
  | { type: "ready"; url: string; revision: number };
export type Snapshot = { files: Files; install: string; start: string };
export interface Worker {
  write(path: string, content: string): Promise<void>;
  read?(path: string): Promise<string>;
  list?(): Promise<string[]>;
  verify?(files: Files): Promise<void>;
  run(command: string): Promise<void>;
  start(command: string): Promise<void>;
  stop(): Promise<void>;
  preparePreview?(files: Files): Promise<void>;
}
type Model = (
  input: { request: string; files: Files; diagnostic: string; attempt: number },
  signal: AbortSignal,
) => AsyncIterable<string>;

export async function buildApp(
  initial: Snapshot,
  request: string,
  model: Model,
  worker: Worker,
  emit: (event: Event) => void,
  signal: AbortSignal,
): Promise<Snapshot> {
  const files: Files = Object.assign(Object.create(null), initial.files);
  for (const [path, content] of Object.entries(files)) {
    signal.throwIfAborted();
    await worker.write(path, content);
  }
  let install = initial.install,
    start = initial.start,
    diagnostic = "",
    needsSetup = true;
  for (let attempt = 0; attempt <= 3; attempt++) {
    signal.throwIfAborted();
    if (attempt) emit({ type: "repair", attempt, text: diagnostic });
    const parser = new ArtifactParser();
    const commands: string[] = [];
    let file = "",
      body = "",
      launch = "",
      changed = 0;
    try {
      for await (const token of model(
        { request, files, diagnostic, attempt },
        signal,
      )) {
        signal.throwIfAborted();
        for (const event of parser.push(token)) {
          switch (event.type) {
            case "fileStart":
              file = event.path;
              body = "";
              break;
            case "fileChunk":
              body += event.text;
              break;
            case "fileComplete":
              if (Object.keys(files).length >= 120 && !(file in files))
                throw Error("Source file limit exceeded.");
              if (body.length > 150000)
                throw Error("File exceeds the workspace limit.");
              await worker.write(file, body);
              files[file] = body;
              changed++;
              break;
            case "shell":
              commands.push(event.command);
              break;
            case "start":
              launch = event.command;
              break;
          }
          emit(event);
        }
      }
      parser.finish();
      if (worker.verify) {
        if (!changed)
          throw Error("Write the project files before verification.");
        if (commands.length || launch)
          throw Error(
            "The built-in engine compiles your app directly. Emit file actions only, without setup or start commands.",
          );
        emit({
          type: "stage",
          text: "Checking TypeScript and compiling the built-in preview",
        });
        await worker.verify(files);
        return { files, install, start };
      }
      if (
        !files["package.json"] ||
        !files["tsconfig.json"] ||
        (!changed && !commands.length && !launch)
      )
        throw Error(
          "Expected complete project files including package.json and tsconfig.json.",
        );
      if (!attempt && !initial.install && (!launch || !commands.length))
        throw Error("New applications require setup and a start action.");
      // tsc accepts hooks in a Next server component. Give the generator the
      // actionable source path before spending time installing dependencies.
      for (const [name, source] of Object.entries(files)) {
        if (!/^(?:src\/)?app\/(?:.*\/)?(?:page|layout)\.[jt]sx$/.test(name))
          continue;
        const ast = ts.createSourceFile(
          name,
          source,
          ts.ScriptTarget.Latest,
          false,
          ts.ScriptKind.TSX,
        );
        const usesHooks = ast.statements.some((s) => {
          if (
            !ts.isImportDeclaration(s) ||
            !ts.isStringLiteral(s.moduleSpecifier) ||
            s.moduleSpecifier.text !== "react" ||
            s.importClause?.isTypeOnly
          )
            return false;
          const binding = s.importClause?.namedBindings;
          return (
            binding &&
            ts.isNamedImports(binding) &&
            binding.elements.some(
              (e) =>
                !e.isTypeOnly &&
                /^(useState|useEffect|useReducer|useLayoutEffect)$/.test(
                  (e.propertyName || e.name).text,
                ),
            )
          );
        });
        checkNativeForms(ast, files);
        const directive = ast.statements.some(
          (s) =>
            ts.isExpressionStatement(s) &&
            ts.isStringLiteral(s.expression) &&
            s.expression.text === "use client",
        );
        if (usesHooks && !directive)
          throw Error(
            name +
              " calls React hooks in a Server Component. Split the interactive UI into a 'use client' component or add 'use client' at the top. Fetch data from your API routes and keep Prisma imports on the server.",
          );
      }
      if (launch) start = launch;
      // Install the saved project when a fresh sandbox receives a patch-only revision.
      const installsDeps = commands.some((c) =>
        /\b(?:npm\s+(?:ci|install|i)|pnpm\s+(?:install|i)|yarn\s+install)\b/.test(
          c,
        ),
      );
      const inheritedSetup =
        needsSetup && install && !installsDeps ? [install] : [];
      if (commands.length && (!attempt || needsSetup))
        install = [...inheritedSetup, ...commands].join("\n");
      if (!install || !start) throw Error("Missing setup or start command.");
      const setup = commands.length
        ? [...inheritedSetup, ...commands]
        : needsSetup
          ? [install]
          : [];
      for (const command of setup) {
        if (
          /(?:^|[;&|\n])\s*(?:npm\s+(?:run\s+)?(?:dev|start)|(?:npx\s+)?next\s+(?:dev|start))(?:\s|$)/m.test(
            command,
          )
        )
          throw Error(
            "A development server was placed in a setup shell action. Put only terminating install, schema and seed commands in shell actions, and put the server command in the final start action.",
          );
        signal.throwIfAborted();
        emit({ type: "stage", text: "Running " + command });
        await worker.run(command);
      }
      needsSetup = false;
      if (files["prisma/schema.prisma"]?.match(/provider\s*=\s*"sqlite"/)) {
        emit({ type: "stage", text: "Verifying the preview database schema" });
        await worker.run(
          "npx --no-install prisma generate && npx --no-install prisma db push --skip-generate",
        );
      }
      await worker.preparePreview?.(files);
      emit({ type: "stage", text: "Checking TypeScript" });
      await worker.run(
        "test -f tsconfig.json && test -x node_modules/.bin/tsc && npx --no-install tsc --noEmit",
      );
      emit({ type: "stage", text: "Starting preview on port 3000" });
      await worker.start(start);
      return { files, install, start };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ProviderFailure) throw error;
      diagnostic = (
        error instanceof Error ? error.message : String(error)
      ).slice(-6500);
      if (attempt === 3)
        throw Error("Build failed after three repairs. " + diagnostic);
      await worker.stop();
    }
  }
  throw Error("Build did not complete.");
}
