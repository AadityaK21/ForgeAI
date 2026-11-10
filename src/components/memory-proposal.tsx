"use client";
import { useEffect, useState } from "react";
import { preferenceSchema } from "@/lib/memory-options";
import { MemoryUndo } from "./memory-undo";
type Confirmation = {
  status: string;
  tainted: boolean;
  undoId: string | null;
  expiresAt: string;
};
export function MemoryProposal({ id, input }: { id: string; input: string }) {
  const [state, setState] = useState<Confirmation | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/agent/confirmations?id=" + encodeURIComponent(id), {
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.ok && live) setState(await response.json());
      })
      .catch(() => {
        if (live)
          setNotice("Could not load confirmation. Reopen this chat to retry.");
      });
    return () => {
      live = false;
    };
  }, [id]);
  let candidate: unknown;
  try {
    candidate = JSON.parse(input);
  } catch {
    return null;
  }
  const parsed = preferenceSchema.safeParse(candidate);
  if (!parsed.success || !state)
    return notice ? <p role="status">{notice}</p> : null;
  const preference = parsed.data;
  const pending =
    state.status === "pending" &&
    new Date(state.expiresAt).getTime() > Date.now();
  async function decide(decision: "approve" | "deny") {
    if (busy) return;
    setBusy(true);
    setNotice("Resuming this run...");
    try {
      const response = await fetch("/api/agent/confirmations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: id, decision }),
      });
      if (!response.ok) throw Error((await response.json()).error);
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === "memory_saved")
            setState(
              (current) =>
                current && {
                  ...current,
                  status: "completed",
                  undoId: event.undoId,
                },
            );
          if (event.type === "error") setNotice(event.error);
        }
      }
      const latest = await fetch(
        "/api/agent/confirmations?id=" + encodeURIComponent(id),
        { cache: "no-store" },
      );
      if (latest.ok) setState(await latest.json());
      setNotice("Run resumed. Review the updated reply and action status.");
      window.dispatchEvent(new Event("agent-resumed"));
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not resume. Reopen this chat to check its status.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="memory-proposal" aria-label="Confirm tool call">
      <strong>Confirm save memory</strong>
      <p>
        Remember {preference.category}: <strong>{preference.value}</strong> for
        180 days? This replaces your saved {preference.category} preference.
      </p>
      {state.tainted && (
        <p>
          This run read web content. Check this preference carefully before
          approving it.
        </p>
      )}
      {pending && (
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide("approve")}
          >
            Approve
          </button>{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide("deny")}
          >
            Deny
          </button>
          <p>Approval covers this call only.</p>
        </div>
      )}
      {!pending && (
        <p>Action: {state.status === "pending" ? "expired" : state.status}.</p>
      )}
      {state.undoId && <MemoryUndo id={state.undoId} />}
      <p role="status">{notice}</p>
    </div>
  );
}
