"use client";
import { MemoryUndo } from "./memory-undo";
import { useEffect, useState } from "react";
import { memoryOptions, type MemoryCategory } from "@/lib/memory-options";
type Memory = {
  category: MemoryCategory;
  value: string;
  source: string;
  expiresAt: string;
};
export function MemorySettings() {
  const [undoId, setUndoId] = useState("");
  const [enabled, setEnabled] = useState(false),
    [memories, setMemories] = useState<Memory[]>([]),
    [ready, setReady] = useState(false);
  const [category, setCategory] = useState<MemoryCategory>("language"),
    [value, setValue] = useState<string>("English");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function load() {
    const response = await fetch("/api/memories", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Could not load preferences.");
    setEnabled(data.enabled);
    setMemories(data.memories);
    setReady(true);
  }
  useEffect(() => {
    const changed = () => {
      void load().catch(() => {});
    };
    window.addEventListener("memory-changed", changed);
    void load().catch(() =>
      setNotice(
        "Could not load preferences. Close and reopen Settings to retry.",
      ),
    );
    return () => window.removeEventListener("memory-changed", changed);
  }, []);
  async function change(method: string, body: object, message: string) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/memories", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      await load();
      if (data.undoId) setUndoId(data.undoId);
      setNotice(message);
    } catch (e) {
      await load().catch(() => {});
      setNotice(
        e instanceof Error ? e.message : "Could not update preferences.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="memory-settings" aria-labelledby="memory-heading">
      <h3 id="memory-heading">Preference memory</h3>
      <p className="settings-note">
        Opt in to remember language, tone and answer length across agent chats.
        No free text or private details can be saved. Normal chat does not use
        memory.
      </p>
      <label className="memory-switch">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!ready || busy}
          onChange={(e) => {
            const next = e.target.checked;
            setEnabled(next);
            void change("PATCH", { enabled: next }, "Memory setting updated.");
          }}
        />{" "}
        Use preference memory
      </label>
      {memories.length ? (
        <ul className="memory-list">
          {memories.map((m) => (
            <li key={m.category}>
              <strong>
                {m.category}: {m.value}
              </strong>
              <span>
                {m.source}.{" "}
                {new Date(m.expiresAt).getTime() <= Date.now()
                  ? "Expired"
                  : "Expires"}{" "}
                {new Date(m.expiresAt).toLocaleDateString()}.
              </span>
              <button
                type="button"
                disabled={busy || !enabled}
                onClick={() => {
                  setCategory(m.category);
                  setValue(m.value);
                  setNotice("Change the value below, then save.");
                }}
              >
                Edit {m.category}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void change(
                    "DELETE",
                    { category: m.category },
                    "Preference deleted. Future recalls will not use it.",
                  )
                }
              >
                Delete {m.category}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-note">No preferences saved.</p>
      )}
      <div className="memory-editor">
        <label>
          Preference type
          <select
            aria-label="Preference type"
            value={category}
            disabled={!enabled || busy}
            onChange={(e) => {
              const next = e.target.value as MemoryCategory;
              setCategory(next);
              setValue(memoryOptions[next][0]);
            }}
          >
            <option value="language">Language</option>
            <option value="tone">Tone</option>
            <option value="detail">Answer length</option>
          </select>
        </label>
        <label>
          Preference value
          <select
            aria-label="Preference value"
            value={value}
            disabled={!enabled || busy}
            onChange={(e) => setValue(e.target.value)}
          >
            {memoryOptions[category].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!enabled || busy}
          onClick={() =>
            void change(
              "POST",
              { preference: { category, value }, confirmed: true },
              "Preference saved for 180 days.",
            )
          }
        >
          Save preference
        </button>
      </div>
      {memories.length > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void change("DELETE", {}, "All saved preferences deleted.")
          }
        >
          Delete all preferences
        </button>
      )}
      <p className="settings-note">
        Deleting a preference stops future recall. It does not erase existing
        chat messages or an answer already in progress. Start a new chat for a
        clean context.
      </p>
      {undoId && <MemoryUndo key={undoId} id={undoId} />}
      <p role="status">{notice}</p>
    </section>
  );
}
