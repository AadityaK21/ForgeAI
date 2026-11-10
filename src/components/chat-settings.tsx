"use client";
import { useState } from "react";
import { MemorySettings } from "./memory-settings";
import { ChatDialog } from "./chat-dialog";
import type { ProviderState } from "@/lib/provider-types";
export type ChatConfig = { headers: Record<string, string>; model: string };
export function ChatSettings({
  current,
  status,
  close,
  save,
}: {
  current: ChatConfig;
  status: ProviderState | null;
  close: () => void;
  save: (config: ChatConfig, status: ProviderState) => void;
}) {
  const [provider, setProvider] = useState(
    current.headers["x-forge-provider"] || status?.provider || "anthropic",
  );
  const [key, setKey] = useState("");
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [model, setModel] = useState(current.model);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedHeaders, setLoadedHeaders] = useState<Record<
    string,
    string
  > | null>(null);
  const header =
    provider === "openai" ? "x-forge-openai-key" : "x-forge-anthropic-key";
  function reset() {
    setModels([]);
    setLoadedHeaders(null);
    setError("");
  }
  async function load() {
    setBusy(true);
    setError("");
    const headers = {
      ...current.headers,
      "x-forge-provider": provider,
      ...(key.trim() && provider !== "local" ? { [header]: key.trim() } : {}),
    };
    try {
      const res = await fetch("/api/chat/models", {
        headers,
        cache: "no-store",
        redirect: "error",
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error || "Could not load models.");
      if (!data.models.length)
        throw Error(
          "No compatible chat models were returned by this provider.",
        );
      setModels(data.models);
      setLoadedHeaders(headers);
      setModel(
        data.models.some((m: { id: string }) => m.id === current.model)
          ? current.model
          : data.models.some((m: { id: string }) => m.id === status?.modelLabel)
            ? status!.modelLabel
            : data.models[0].id,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not reach the provider.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function apply(forget = false) {
    setBusy(true);
    setError("");
    try {
      const headers = forget ? {} : loadedHeaders!;
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ persist: false }),
        redirect: "error",
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Could not save settings.");
      save({ headers, model: forget ? "" : model }, data);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ChatDialog
      title="Model & API settings"
      close={() => {
        if (!busy) close();
      }}
    >
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
      >
        <p className="secondary">
          Choose the provider that answers your messages.
        </p>
        <label>
          Provider
          <select
            aria-label="Provider"
            value={provider}
            disabled={busy}
            onChange={(e) => {
              setProvider(e.target.value);
              setKey("");
              reset();
            }}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            {status?.providers.local && (
              <option value="local">Local Ollama</option>
            )}
          </select>
        </label>
        {provider !== "local" && (
          <label>
            API key{" "}
            <span className="secondary">
              {current.headers[header]
                ? "Available in this tab"
                : status?.providers[provider as "anthropic" | "openai"]
                  ? "Server key configured"
                  : "Required"}
            </span>
            <input
              aria-label="API key"
              type="password"
              value={key}
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              placeholder={
                status?.providers[provider as "anthropic" | "openai"] ||
                current.headers[header]
                  ? "Leave blank to keep the current key"
                  : "Paste your provider API key"
              }
              disabled={busy}
              onChange={(e) => {
                setKey(e.target.value);
                reset();
              }}
            />
          </label>
        )}
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy
            ? "Connecting…"
            : models.length
              ? "Refresh available models"
              : "Load available models"}
        </button>
        {models.length > 0 && (
          <label>
            Model
            <select
              aria-label="Model"
              value={model}
              disabled={busy}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="settings-note">
          API keys stay in this tab&apos;s memory and clear when you reload or
          sign out. They are sent securely to our server for provider requests
          and are never saved with your chats. Your conversation is sent to the
          provider you select.
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {Object.keys(current.headers).some((k) => k.endsWith("-key")) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void apply(true)}
            >
              Forget tab keys
            </button>
          )}
          <button
            className="primary-button"
            disabled={busy || !loadedHeaders || !model}
          >
            Apply settings
          </button>
        </div>
      </form>
      <MemorySettings />
    </ChatDialog>
  );
}
