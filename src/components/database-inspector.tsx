"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Database, RefreshCw, Play, Braces } from "lucide-react";
import type { AppRoute } from "@/lib/studio-project";
import styles from "./studio-inspector.module.css";
type Snapshot = {
  routes: AppRoute[];
  tables: string[];
  columns: string[];
  rows: Record<string, unknown>[];
  live: boolean;
  info?: string;
};
type Props = {
  projectId: string;
  revision: number;
  headers?: Record<string, string>;
};
export function DatabaseInspector({ projectId, revision, headers }: Props) {
  const [db, setDb] = useState<Snapshot | null>(null),
    [table, setTable] = useState(""),
    [error, setError] = useState(""),
    [waiting, setWaiting] = useState(false);
  const [choice, setChoice] = useState(""),
    [path, setPath] = useState(""),
    [method, setMethod] = useState("GET"),
    [body, setBody] = useState("{}"),
    [sending, setSending] = useState(false),
    [response, setResponse] = useState("");
  const ref = useRef(headers);
  ref.current = headers;
  const current = useRef<AbortController | null>(null),
    probe = useRef<AbortController | null>(null);
  const load = useCallback(
    async (selected: string) => {
      current.current?.abort();
      const controller = new AbortController();
      current.current = controller;
      setError("");
      setWaiting(true);
      try {
        const query = new URLSearchParams({ projectId });
        if (selected) query.set("table", selected);
        const res = await fetch("/api/sandbox/inspect?" + query, {
            headers: ref.current,
            cache: "no-store",
            signal: controller.signal,
          }),
          data = await res.json();
        if (!res.ok)
          throw Error(data.error || "Unable to inspect this preview.");
        if (!controller.signal.aborted) setDb(data);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(
            e instanceof Error ? e.message : "Unable to inspect this preview.",
          );
          setDb(null);
        }
      } finally {
        if (!controller.signal.aborted) setWaiting(false);
      }
    },
    [projectId],
  );
  useEffect(() => {
    setDb(null);
    setTable("");
    setChoice("");
    setPath("");
    setResponse("");
    void load("");
    return () => {
      current.current?.abort();
      probe.current?.abort();
    };
  }, [projectId, revision, load]);
  const route = db?.routes.find((r) => r.path === choice);
  function choose(target: AppRoute | undefined) {
    setChoice(target?.path || "");
    setPath(target?.path || "");
    setMethod(target?.methods[0] || "GET");
    setResponse("");
  }
  async function send() {
    if (!route || sending) return;
    setSending(true);
    setResponse("");
    const controller = new AbortController();
    probe.current = controller;
    try {
      const res = await fetch("/api/sandbox/inspect", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", ...ref.current },
        body: JSON.stringify({
          projectId,
          path,
          method,
          ...(["GET", "HEAD"].includes(method) || !body.trim() ? {} : { body }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error || "Request failed.");
      let content = data.body;
      try {
        content = JSON.stringify(JSON.parse(content), null, 2);
      } catch {}
      setResponse(
        "HTTP " +
          data.status +
          "\n" +
          content +
          (data.truncated ? "\n… response truncated" : ""),
      );
      if (!["GET", "HEAD"].includes(method)) void load(table);
    } catch (e) {
      if (!controller.signal.aborted)
        setResponse(e instanceof Error ? e.message : "Request failed.");
    } finally {
      if (!controller.signal.aborted) setSending(false);
    }
  }
  return (
    <section className={styles.data} aria-label="Database and API inspector">
      <header>
        <div>
          <small>INSPECTOR</small>
          <h2>
            <Database size={20} />
            Preview data
          </h2>
        </div>
        <button
          aria-label="Refresh preview data"
          disabled={waiting}
          onClick={() => void load(table)}
        >
          <RefreshCw size={15} />
        </button>
      </header>
      {waiting && <p role="status">Reading preview data…</p>}
      {error && <p role="alert">{error}</p>}
      {db && (
        <>
          <div className={styles.dataSection}>
            <h3>Database tables</h3>
            {db.tables.length ? (
              <>
                <select
                  aria-label="Database table"
                  value={table}
                  onChange={(e) => {
                    setTable(e.target.value);
                    void load(e.target.value);
                  }}
                >
                  <option value="">Choose a table</option>
                  {db.tables.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                {table && db.columns.length > 0 && (
                  <div className={styles.tableWrap}>
                    <table>
                      <caption>{table} · up to 20 rows</caption>
                      <thead>
                        <tr>
                          {db.columns.map((c) => (
                            <th scope="col" key={c}>
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {db.rows.map((r, i) => (
                          <tr key={i}>
                            {db.columns.map((c) => (
                              <td key={c}>{String(r[c] ?? "")}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {db.rows.length === 0 && <p>This table is empty.</p>}
                  </div>
                )}
              </>
            ) : (
              <p>
                {db.info ||
                  (db.live
                    ? "No data tables were found."
                    : "Build the project to open its database.")}
              </p>
            )}
          </div>
          <div className={styles.dataSection}>
            <h3>
              <Braces size={17} />
              API explorer
            </h3>
            {db.routes.length > 0 ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label>
                  Endpoint
                  <select
                    value={choice}
                    onChange={(e) =>
                      choose(db.routes.find((r) => r.path === e.target.value))
                    }
                  >
                    <option value="">Choose a route</option>
                    {db.routes.map((r) => (
                      <option key={r.path} value={r.path}>
                        {r.path}
                      </option>
                    ))}
                  </select>
                </label>
                {route && (
                  <>
                    <div className={styles.apiRow}>
                      <label>
                        Method
                        <select
                          value={method}
                          onChange={(e) => setMethod(e.target.value)}
                        >
                          {route.methods.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Request path
                        <input
                          value={path}
                          required
                          onChange={(e) => setPath(e.target.value)}
                        />
                      </label>
                    </div>
                    {!["GET", "HEAD"].includes(method) && (
                      <label>
                        JSON body
                        <textarea
                          value={body}
                          onChange={(e) => setBody(e.target.value)}
                          rows={4}
                        />
                      </label>
                    )}
                    <button
                      className={styles.primary}
                      type="submit"
                      disabled={!db.live || sending}
                    >
                      <Play size={13} />
                      {sending ? "Sending…" : "Send request"}
                    </button>
                  </>
                )}
              </form>
            ) : (
              <p>No API routes were found in this revision.</p>
            )}
            {response && <pre role="status">{response}</pre>}
          </div>
        </>
      )}
    </section>
  );
}
