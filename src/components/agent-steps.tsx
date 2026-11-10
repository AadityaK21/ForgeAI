"use client";
import { MemoryProposal } from "./memory-proposal";
import { Fragment, useState } from "react";
export type RunView = {
  id: string;
  status: string;
  contextSnapshot?: string | null;
  tokens?: number;
  cost?: number;
  steps: {
    id: string;
    name: string;
    input: string;
    preview: string;
    failed: boolean;
    sources: string;
  }[];
};
function FullOutput({ id }: { id: string }) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const response = await fetch(
              "/api/agent/outputs?id=" + encodeURIComponent(id),
              { cache: "no-store" },
            );
            const data = await response.json();
            if (!response.ok) throw Error(data.error);
            setText(data.content);
          } catch {
            setError("Could not load this output. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Loading output..." : "Read full saved output"}
      </button>
      {error && <p role="alert">{error}</p>}
      {text && <pre>{text}</pre>}
    </>
  );
}
export function AgentSteps({ runs }: { runs?: RunView[] }) {
  return (
    <>
      {runs?.map((run) => (
        <section
          key={run.id}
          className="agent-steps"
          aria-label="Agent activity"
        >
          <p className="agent-status">
            Agent: {run.status.replaceAll("_", " ")}
            {run.tokens !== undefined && run.status !== "running"
              ? ` · ${run.tokens} tokens · estimated $${(run.cost || 0).toFixed(4)}`
              : ""}
          </p>
          {run.contextSnapshot && (
            <details>
              <summary>Shortened context used for this run</summary>
              <p>
                Older assistant replies were shortened. Your messages and the
                six most recent turns were kept unchanged. Original history is
                still in this chat. Send a correction or clarification if
                needed.
              </p>
              <pre>{formatSnapshot(run.contextSnapshot)}</pre>
            </details>
          )}
          {run.steps.map((step) => (
            <Fragment key={step.id}>
              <details>
                <summary>
                  {step.name.replaceAll("_", " ")}
                  {step.failed ? " · incomplete or failed" : ""}
                </summary>
                <pre>{step.input}</pre>
                <pre>{step.preview}</pre>
                <FullOutput id={step.id} />
                {safeSources(step.sources).map((url, i) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Source {i + 1}
                  </a>
                ))}
              </details>
              {step.name === "save_memory" && run.status !== "running" && (
                <MemoryProposal id={step.id} input={step.input} />
              )}
            </Fragment>
          ))}
        </section>
      ))}
    </>
  );
}
function safeSources(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (url): url is string =>
            typeof url === "string" && /^https?:\/\//.test(url),
        )
      : [];
  } catch {
    return [];
  }
}

function formatSnapshot(raw: string) {
  try {
    const value = JSON.parse(raw);
    return JSON.stringify(value, null, 2);
  } catch {
    return "Context snapshot unavailable.";
  }
}
