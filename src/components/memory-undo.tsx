"use client";
import { useState } from "react";
export function MemoryUndo({ id }: { id: string }) {
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="memory-saved" role="status">
      <span>{done ? "Memory save undone" : "Saved to memory"}</span>{" "}
      {!done && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const response = await fetch("/api/memories/undo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
              });
              if (!response.ok) throw Error((await response.json()).error);
              setDone(true);
              window.dispatchEvent(new Event("memory-changed"));
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not undo this save.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Undo
        </button>
      )}
      {error && <p>{error}</p>}
    </div>
  );
}
