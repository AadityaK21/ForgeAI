"use client";
import { useState } from "react";
import {
  Cpu,
  KeyRound,
  ArrowUpRight,
} from "lucide-react";
export type RuntimeChoice = "auto" | "instant" | "local" | "cloud";
export type KeyHeaders = Record<string, string>;
export type ProviderState = {
  providers: {
    anthropic: boolean;
    openai: boolean;
    local: boolean;
    e2b: boolean;
  };
  provider: string | null;
  modelLabel: string;
  canSaveToServer: boolean;
};
const keys = [
  ["Anthropic", "x-forge-anthropic-key", "anthropic"],
  ["OpenAI", "x-forge-openai-key", "openai"],
  ["E2B", "x-forge-e2b-key", "e2b"],
] as const;
export function ProviderSettings({
  status,
  headers,
  runtime,
  locked,
  signedIn,
  onSave,
  onSignIn,
}: {
  status: ProviderState | null;
  headers: KeyHeaders;
  runtime: RuntimeChoice;
  locked: boolean;
  signedIn: boolean;
  onSave: (h: KeyHeaders, s: ProviderState, r: RuntimeChoice) => void;
  onSignIn: () => void;
}) {
  const [input, setInput] = useState<KeyHeaders>({}),
    [preferred, setPreferred] = useState(headers["x-forge-provider"] || "auto"),
    [engine, setEngine] = useState(runtime),
    [persist, setPersist] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function save(clear = false) {
    if (saving || locked) return;
    if (!signedIn) {
      onSignIn();
      return;
    }
    const h: KeyHeaders = clear
      ? {}
      : { ...headers, "x-forge-provider": preferred };
    for (const [, key] of keys)
      if (!clear && input[key]?.trim()) h[key] = input[key].trim();
    if (keys.some(([, key]) => h[key]) && !window.isSecureContext) {
      setError("Open ForgeAI over HTTPS or localhost to use private keys.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...h },
        body: JSON.stringify({ persist: !clear && persist }),
        cache: "no-store",
        redirect: "error",
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error || "Could not apply settings.");
      onSave(
        persist && !clear ? { "x-forge-provider": preferred } : h,
        data,
        engine,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="fx-key-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="fx-setting-summary">
        <div className="fx-setting-icon">
          <Cpu size={22} />
        </div>
        <div>
          <small>GENERATION ENGINE</small>
          <strong>
            {signedIn
              ? status?.modelLabel || "Choose a provider"
              : "Your model, your workspace"}
          </strong>
        </div>
      </div>
      <div className="fx-setting-pair">
        <label>
          Model provider
          <select
            value={preferred}
            disabled={locked}
            onChange={(e) => setPreferred(e.target.value)}
          >
            <option value="auto">Automatic</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="local">Local Ollama</option>
          </select>
        </label>
        <label>
          Build runtime
          <select
            value={engine}
            disabled={locked}
            onChange={(e) => setEngine(e.target.value as RuntimeChoice)}
          >
            <option value="auto">Automatic</option>
            <option value="instant">Built-in instant engine</option>
            <option value="cloud">E2B cloud VM</option>
            <option value="local">Local Docker</option>
          </select>
        </label>
      </div>
      <p className="fx-setting-note">
        Instant builds run a React preview with a project SQLite database.
        Choose Docker or E2B to run a full Linux application.
      </p>
      <fieldset disabled={locked || !signedIn || saving}>
        <legend>
          <KeyRound size={15} /> Provider keys
        </legend>
        {keys.map(([name, key, flag]) => (
          <label key={key}>
            <span>
              {name}
              {name === "E2B" ? " sandbox" : " API"} key{" "}
              <small>
                {headers[key]
                  ? "In this tab"
                  : status?.providers[flag]
                    ? "Available"
                    : "Optional"}
              </small>
            </span>
            <input
              type="password"
              value={input[key] || ""}
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              placeholder={
                status?.providers[flag]
                  ? "Enter a replacement key"
                  : "Paste key"
              }
              onChange={(e) => setInput({ ...input, [key]: e.target.value })}
            />
          </label>
        ))}
      </fieldset>
      {signedIn && status?.canSaveToServer ? (
        <label className="fx-persist">
          <input
            type="checkbox"
            checked={persist}
            onChange={(e) => setPersist(e.target.checked)}
          />
          Save keys to this computer’s .env.local
        </label>
      ) : null}
      <p className="fx-setting-note">
        {signedIn
          ? "Tab keys clear when you reload or sign out."
          : "Sign in to use private provider keys. You can use the server’s configured model without entering a key."}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="fx-setting-actions">
        <button className="fx-primary" disabled={locked || saving}>
          {saving
            ? "Saving…"
            : signedIn
              ? "Apply settings"
              : "Sign in to configure"}{" "}
          <ArrowUpRight size={15} />
        </button>
        {signedIn && keys.some(([, k]) => headers[k]) && (
          <button
            disabled={saving || locked}
            type="button"
            onClick={() => void save(true)}
          >
            Forget tab keys
          </button>
        )}
      </div>
    </form>
  );
}
