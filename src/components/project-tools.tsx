"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  ScanLine,
  MousePointer2,
  X,
  ChevronRight,
} from "lucide-react";
import { projectZip, reviewSources, type Finding } from "@/lib/project-review";
import styles from "./project-tools.module.css";
import { useInstantData } from "@/lib/preview-messaging";

type Selection = {
  selector: string;
  tag: string;
  text: string;
  path: string;
  editable: boolean;
};
const kind = "forge-inspector-v1";
export function VisualPreview({
  url,
  mobile,
  tablet = false,
  inspect,
  onInspect,
  refresh,
  onEdit,
}: {
  url: string;
  mobile: boolean;
  tablet?: boolean;
  inspect?: boolean;
  onInspect?: (value: boolean) => void;
  refresh: number;
  onEdit: (brief: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const channel = useRef("");
  const [internalActive, setInternalActive] = useState(false),
    [ready, setReady] = useState(false),
    [selection, setSelection] = useState<Selection | null>(null);
  const [request, setRequest] = useState(""),
    [newText, setNewText] = useState(""),
    [background, setBackground] = useState(""),
    [color, setColor] = useState("");
  const active = inspect ?? internalActive;
  const setActive = useCallback(
    (v: boolean) => {
      setInternalActive(v);
      onInspect?.(v);
    },
    [onInspect],
  );
  const instant = url.startsWith("/api/instant/preview?");
  const [documentHtml, setDocumentHtml] = useState(""),
    [previewError, setPreviewError] = useState("");
  useInstantData(frame, url, instant);
  useEffect(() => {
    setDocumentHtml("");
    setPreviewError("");
    if (!instant) return;
    const abort = new AbortController();
    fetch(url, { cache: "no-store", signal: abort.signal, redirect: "error" })
      .then(async (res) => {
        if (!res.ok) throw Error("The preview could not be opened.");
        const html = await res.text();
        if (!abort.signal.aborted) setDocumentHtml(html);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setPreviewError(e.message);
      });
    return () => abort.abort();
  }, [instant, url, refresh]);
  let origin = "";
  try {
    const u = new URL(url);
    if (["http:", "https:"].includes(u.protocol)) origin = u.origin;
  } catch {}
  if (instant) origin = "null";
  const post = useCallback(
    (type: string, data: Record<string, unknown> = {}) => {
      if (origin && origin !== window.location.origin && channel.current)
        frame.current?.contentWindow?.postMessage(
          { kind, channel: channel.current, type, ...data },
          instant ? "*" : origin,
        );
    },
    [origin, instant],
  );
  const sync = useCallback(() => post("mode", { active }), [active, post]);
  useEffect(() => {
    channel.current = crypto.randomUUID();
    setReady(false);
    setSelection(null);
    setInternalActive(false);
    return () => {
      channel.current = "";
    };
  }, [url, refresh]);
  useEffect(() => {
    function receive(e: MessageEvent) {
      const m = e.data;
      if (
        !origin ||
        origin === window.location.origin ||
        e.origin !== origin ||
        e.source !== frame.current?.contentWindow ||
        !m ||
        m.kind !== kind
      )
        return;
      if (m.type === "boot") {
        sync();
        return;
      }
      if (!channel.current || m.channel !== channel.current) return;
      if (m.type === "ready") {
        setReady(true);
        return;
      }
      if (m.type === "exit") {
        setActive(false);
        setSelection(null);
        return;
      }
      if (
        !active ||
        m.type !== "selected" ||
        typeof m.selector !== "string" ||
        !m.selector ||
        m.selector.length > 500 ||
        typeof m.path !== "string" ||
        m.path.length > 300 ||
        typeof m.tag !== "string" ||
        m.tag.length > 80 ||
        typeof m.text !== "string" ||
        m.text.length > 250
      )
        return;
      setSelection({
        selector: m.selector,
        tag: m.tag,
        path: m.path,
        text: m.text,
        editable: m.editable === true,
      });
      setNewText(m.text);
      setColor("");
      setBackground("");
      setRequest("");
    }
    window.addEventListener("message", receive);
    sync();
    return () => window.removeEventListener("message", receive);
  }, [active, origin, sync]);
  const validColor = (v: string) => !v || /^#[\da-fA-F]{6}$/.test(v);
  const valid = validColor(color) && validColor(background);
  const changed =
    !!selection &&
    (color !== "" ||
      background !== "" ||
      (selection.editable && selection.text !== newText));
  const changes = {
    ...(selection?.editable && selection.text !== newText
      ? { text: newText }
      : {}),
    color,
    background,
  };
  const [studioHost, setStudioHost] = useState("");
  useEffect(() => setStudioHost(window.location.hostname), []);
  if (previewError) return <p role="alert">{previewError}</p>;
  if (
    !instant &&
    (!origin || !studioHost || new URL(origin).hostname === studioHost)
  )
    return (
      <p className={styles.help}>
        The preview needs a separate hostname to keep the studio session
        private.
      </p>
    );
  return (
    <div className={styles.preview}>
      <div className={styles.tools}>
        <button
          className={styles.button}
          type="button"
          aria-pressed={active}
          onClick={() => {
            setActive(!active);
            setSelection(null);
          }}
        >
          <MousePointer2 size={15} />
          {active ? "Exit visual edit" : "Visual edit mode"}
        </button>
        {active && (
          <span role="status">
            {ready
              ? "Click an element to edit it."
              : "Waiting for the inspector. Older previews need a new build."}
          </span>
        )}
      </div>
      {active && selection && (
        <form
          className={styles.edit}
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || (!request.trim() && !changed)) return;
            const instruction =
              "Revise the selected element in the saved project.\nPage: " +
              selection.path +
              "\nElement: " +
              selection.tag +
              "\nSelector: " +
              selection.selector +
              (selection.text
                ? "\nExisting visible text: " + JSON.stringify(selection.text)
                : "") +
              (changes.text !== undefined
                ? "\nReplace its text with: " + JSON.stringify(changes.text)
                : "") +
              (background ? "\nBackground color: " + background : "") +
              (color ? "\nText color: " + color : "") +
              (request.trim() ? "\nRequested change: " + request.trim() : "");
            post("reset");
            setActive(false);
            setSelection(null);
            onEdit(instruction);
          }}
        >
          <b>Selected element</b>
          <code>{selection.selector}</code>
          {selection.editable && (
            <label>
              Element text
              <input
                maxLength={250}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
              />
            </label>
          )}
          <div className={styles.colors}>
            {(
              [
                ["Text color", color, setColor],
                ["Background", background, setBackground],
              ] as const
            ).map(([label, value, set]) => (
              <label key={label}>
                {label}
                <input
                  aria-invalid={!validColor(value)}
                  placeholder="#223344"
                  maxLength={7}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                />
              </label>
            ))}
          </div>
          <label>
            Change request
            <textarea
              maxLength={2000}
              rows={2}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="What should change about this element?"
            />
          </label>
          <div className={styles.tools}>
            <button
              className={styles.button}
              type="button"
              disabled={!valid || !changed}
              onClick={() => post("try", changes)}
            >
              Try in preview
            </button>
            <button
              className={styles.button}
              type="submit"
              disabled={!valid || (!request.trim() && !changed)}
            >
              Use in build brief <ChevronRight size={14} />
            </button>
          </div>
          <p className={styles.help}>
            Preview tweaks last until you exit. Run the resulting brief to save
            a revision.
          </p>
        </form>
      )}
      <iframe
        key={url + ":" + refresh}
        ref={frame}
        title="Sandbox application"
        className={mobile ? "mobile" : tablet ? "tablet" : ""}
        src={instant ? undefined : url}
        srcDoc={instant ? documentHtml : undefined}
        sandbox={
          instant
            ? "allow-scripts allow-forms"
            : "allow-scripts allow-same-origin allow-forms allow-modals"
        }
        referrerPolicy="origin"
        onLoad={() => {
          setReady(false);
          setSelection(null);
          sync();
        }}
      />
    </div>
  );
}

export function ProjectActions({
  title,
  files,
  projectId,
}: {
  title: string;
  files: Record<string, string>;
  projectId?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [findings, setFindings] = useState<Finding[]>([]),
    [building, setBuilding] = useState(false),
    [error, setError] = useState("");
  const count = Object.keys(files).length;
  async function download() {
    setError("");
    setBuilding(true);
    try {
      let blob: Blob;
      if (projectId) {
        const response = await fetch(
          "/api/sandbox/export?projectId=" + encodeURIComponent(projectId),
          { cache: "no-store" },
        );
        if (!response.ok) throw Error("Could not export the saved project.");
        blob = await response.blob();
      } else {
        blob = new Blob([new Uint8Array(await projectZip(files))], {
          type: "application/zip",
        });
      }
      const objectURL = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectURL;
      link.download =
        (title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "project") + ".zip";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBuilding(false);
    }
  }
  return (
    <div className={styles.actions}>
      <button
        className={styles.button}
        disabled={!count}
        onClick={() => {
          setFindings(reviewSources(files));
          dialog.current?.showModal();
        }}
      >
        <ScanLine size={15} />
        Audit
      </button>
      <button
        className={styles.button}
        disabled={!count || building}
        onClick={download}
      >
        <Download size={15} />
        {building ? "Exporting…" : "Export ZIP"}
      </button>
      {error && <span role="alert">{error}</span>}
      <dialog
        className={styles.dialog}
        ref={dialog}
        aria-labelledby="audit-heading"
      >
        <div className={styles.heading}>
          <h2 id="audit-heading">Security &amp; production audit</h2>
          <button
            type="button"
            aria-label="Close audit"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <p>
          Checked {count} saved {count === 1 ? "file" : "files"} for credential
          patterns, risky data access, route validation and dependency
          configuration.
        </p>
        {findings.length ? (
          <ol className={styles.findings}>
            {findings.map((f, i) => (
              <li key={i}>
                <small>{f.level}</small>
                <strong>{f.check}</strong>
                <code>
                  {f.path}:{f.line}
                </code>
                <p>{f.advice}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.clear}>
            No matches for the source checks in this revision.
          </p>
        )}
        <p className={styles.help}>
          These checks inspect source text. Runtime permissions and published
          dependency vulnerabilities need separate verification. Exported
          environment files retain variable names and local SQLite paths.
        </p>
      </dialog>
    </div>
  );
}
