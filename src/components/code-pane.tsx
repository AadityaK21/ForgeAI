"use client";
import { useEffect, useMemo, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  Save,
} from "lucide-react";
import styles from "./studio-inspector.module.css";
loader.config({ paths: { vs: "/monaco" } });
// Keep unsaved edits across workspace tabs in this browser page. Scope them to
// a verified revision so another person's newer changes cannot be overwritten.
const draftCache = new Map<string, Record<string, string>>();
type CodeProps = {
  files: Record<string, string>;
  path: string;
  onSelect: (name: string) => void;
  projectId?: string;
  revision?: number;
  locked?: boolean;
  headers?: Record<string, string>;
  onSaved?: () => void | Promise<void>;
};
type Entry = { name: string; path: string; children: Map<string, Entry> };
function fileTree(paths: string[]) {
  const root = new Map<string, Entry>();
  for (const path of paths.sort()) {
    let entries = root,
      location = "";
    for (const part of path.split("/")) {
      location = location ? location + "/" + part : part;
      let entry = entries.get(part);
      if (!entry) {
        entry = { name: part, path: location, children: new Map() };
        entries.set(part, entry);
      }
      entries = entry.children;
    }
  }
  return root;
}
export function CodePane({
  files,
  path,
  onSelect,
  projectId,
  revision = 0,
  locked = false,
  headers,
  onSaved,
}: CodeProps) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const cacheKey = (projectId ?? "") + ":" + revision;
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => draftCache.get(cacheKey) || {},
  );
  const [saving, setSaving] = useState(false),
    [notice, setNotice] = useState(""),
    [plain, setPlain] = useState(false);
  useEffect(() => {
    setDrafts(draftCache.get(cacheKey) || {});
    setNotice("");
  }, [cacheKey]);
  const tree = useMemo(() => fileTree(Object.keys(files)), [files]);
  const actual = Object.hasOwn(files, path)
    ? path
    : Object.keys(files)[0] || "";
  const maintained =
    Object.hasOwn(files, "forge.schema.json") &&
    ["runtime/main.tsx", "runtime/server.cjs", "runtime/store.cjs"].includes(
      actual,
    );
  const canEdit =
    !!projectId && revision > 0 && !locked && !saving && !maintained;
  const text = drafts[actual] ?? files[actual] ?? "";
  const dirty = text !== (files[actual] ?? "");
  function change(value: string) {
    const next = { ...drafts };
    if (value === files[actual]) delete next[actual];
    else next[actual] = value;
    draftCache.set(cacheKey, next);
    if (draftCache.size > 12)
      draftCache.delete(draftCache.keys().next().value!);
    setDrafts(next);
    setNotice("");
  }
  function branches(entries: Map<string, Entry>, depth = 0): React.ReactNode {
    return Array.from(entries.values())
      .sort(
        (a, b) =>
          Number(!!b.children.size) - Number(!!a.children.size) ||
          a.name.localeCompare(b.name),
      )
      .map((entry) => {
        if (entry.children.size) {
          const open = !closed.has(entry.path);
          return (
            <div key={entry.path}>
              <button
                className={styles.folder}
                aria-expanded={open}
                style={{ paddingInlineStart: 8 + depth * 12 }}
                onClick={() =>
                  setClosed((previous) => {
                    const next = new Set(previous);
                    if (open) next.add(entry.path);
                    else next.delete(entry.path);
                    return next;
                  })
                }
              >
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Folder size={14} />
                {entry.name}
              </button>
              {open && branches(entry.children, depth + 1)}
            </div>
          );
        }
        return (
          <button
            key={entry.path}
            className={styles.file}
            style={{ paddingInlineStart: 22 + depth * 12 }}
            aria-current={entry.path === actual ? "page" : undefined}
            onClick={() => onSelect(entry.path)}
            title={entry.path}
          >
            <FileCode2 size={13} />
            {entry.name}
            {Object.hasOwn(drafts, entry.path) &&
            drafts[entry.path] !== files[entry.path]
              ? " •"
              : ""}
          </button>
        );
      });
  }
  async function save() {
    if (!canEdit || !dirty) return;
    setSaving(true);
    setNotice("Checking your changes…");
    try {
      const response = await fetch("/api/sandbox", {
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          projectId,
          revision,
          path: actual,
          content: text,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Unable to save this revision.");
      const remaining = { ...drafts };
      delete remaining[actual];
      draftCache.delete(cacheKey);
      if (Object.keys(remaining).length)
        draftCache.set(projectId + ":" + result.revision, remaining);
      await onSaved?.();
      setNotice("Saved and verified revision " + result.revision + ".");
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Unable to save this revision.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (!tree.size)
    return (
      <p className={styles.empty}>
        Files appear here as the agent builds your app.
      </p>
    );
  const languages: Record<string, string> = {
    tsx: "typescript",
    ts: "typescript",
    mjs: "javascript",
    js: "javascript",
    jsx: "javascript",
    md: "markdown",
    css: "css",
    html: "html",
    json: "json",
    sql: "sql",
  };
  return (
    <div className={styles.code}>
      <nav className={styles.tree} aria-label="Project files">
        <small>PROJECT FILES</small>
        {branches(tree)}
      </nav>
      <section className={styles.editor} aria-label="Code editor">
        <div className={styles.bar}>
          <span title={actual}>
            {actual}
            {dirty ? " •" : ""}
          </span>
          <button onClick={() => setPlain((v) => !v)}>
            {plain ? "Rich editor" : "Plain text"}
          </button>
        </div>
        {plain ? (
          <textarea
            className={styles.raw}
            aria-label="Source code"
            spellCheck={false}
            readOnly={!canEdit}
            value={text}
            onChange={(e) => change(e.target.value)}
          />
        ) : (
          <div className={styles.monaco}>
            <Editor
              height="100%"
              theme="vs-dark"
              path={"file:///forge/" + (projectId || "draft") + "/" + actual}
              language={languages[actual.split(".").pop() || ""] || "plaintext"}
              value={text}
              onChange={(v) => {
                if (canEdit && v !== undefined && v !== text) change(v);
              }}
              loading={<p className={styles.empty}>Opening editor…</p>}
              options={{
                readOnly: !canEdit,
                minimap: { enabled: false },
                fontSize: 13,
                automaticLayout: true,
                scrollBeyondLastLine: false,
                wordWrap: "on",
                ariaLabel: "Source code editor",
              }}
            />
          </div>
        )}
        <div className={styles.save}>
          <button
            className={styles.primary}
            disabled={!canEdit || !dirty}
            onClick={save}
          >
            <Save size={14} />
            {saving ? "Verifying…" : "Save & rebuild"}
          </button>
          <span role="status">
            {notice ||
              (maintained
                ? "Portable runtime managed by ForgeAI."
                : locked
                  ? "The agent is writing this revision."
                  : dirty
                    ? "Unsaved changes"
                    : revision
                      ? "Verified source"
                      : "Build this project to edit its source.")}
          </span>
        </div>
      </section>
    </div>
  );
}
