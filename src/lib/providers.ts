import { HttpError } from "./access";

export const keyHeaders = {
  ANTHROPIC_API_KEY: "x-forge-anthropic-key",
  OPENAI_API_KEY: "x-forge-openai-key",
  E2B_API_KEY: "x-forge-e2b-key",
} as const;
type KeyName = keyof typeof keyHeaders;
type KeyMap = Partial<Record<KeyName, string>>;
const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
export function directLocal(req: Request) {
  const host = req.headers.get("host") || "";
  const url = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedFor = req.headers.get("x-forwarded-for");
  return (
    loopback.test(host) &&
    loopback.test(url.host) &&
    (!forwardedHost || forwardedHost === host) &&
    !req.headers.has("forwarded") &&
    (!forwardedFor ||
      /^(?:127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(forwardedFor))
  );
}
export function submittedKeys(req: Request): KeyMap {
  const keys: KeyMap = {};
  for (const name of Object.keys(keyHeaders) as KeyName[]) {
    const value = req.headers.get(keyHeaders[name]);
    if (value === null || value === "") continue;
    if (
      value.length > 512 ||
      !/^[a-zA-Z0-9_.-]{12,}$/.test(value) ||
      !value.startsWith(
        name === "E2B_API_KEY"
          ? "e2b_"
          : name === "ANTHROPIC_API_KEY"
            ? "sk-ant-"
            : "sk-",
      )
    ) {
      throw new HttpError(
        400,
        "Check the format of the " + name + " value in Settings.",
      );
    }
    keys[name] = value;
  }
  if (
    Object.keys(keys).length &&
    new URL(req.url).protocol !== "https:" &&
    !directLocal(req)
  ) {
    throw new HttpError(
      403,
      "Use HTTPS or open the studio on localhost to provide API keys.",
    );
  }
  return keys;
}
export function requestProviders(req: Request) {
  const keys = submittedKeys(req);
  const anthropicKey =
    keys.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = keys.OPENAI_API_KEY || process.env.OPENAI_API_KEY?.trim();
  const e2bKey = keys.E2B_API_KEY || process.env.E2B_API_KEY?.trim();
  const local = process.env.MEROVA_LOCAL_MODEL?.trim();
  const available = {
    anthropic: !!anthropicKey,
    openai: !!openaiKey,
    local: !!local,
    e2b: !!e2bKey,
  };
  const choice = req.headers.get("x-forge-provider") || "auto";
  if (!["auto", "anthropic", "openai", "local"].includes(choice))
    throw new HttpError(400, "Unknown model provider.");
  const provider =
    choice === "auto"
      ? keys.ANTHROPIC_API_KEY
        ? "anthropic"
        : keys.OPENAI_API_KEY
          ? "openai"
          : anthropicKey
            ? "anthropic"
            : openaiKey
              ? "openai"
              : local
                ? "local"
                : null
      : (choice as "anthropic" | "openai" | "local");
  const modelLabel =
    provider === "openai"
      ? process.env.OPENAI_MODEL || "gpt-5.4-mini"
      : provider === "anthropic"
        ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6"
        : provider === "local"
          ? local || "Ollama"
          : "Choose a model";
  const missing = !provider
    ? ["a model provider"]
    : available[provider]
      ? []
      : [
          provider === "openai"
            ? "OPENAI_API_KEY"
            : provider === "anthropic"
              ? "ANTHROPIC_API_KEY"
              : "MEROVA_LOCAL_MODEL",
        ];
  return {
    anthropicKey,
    openaiKey,
    e2bKey,
    available,
    provider,
    modelLabel,
    missing,
  };
}
export type Providers = ReturnType<typeof requestProviders>;
export function canSaveKeys(req: Request, userId: string) {
  return (
    process.env.NODE_ENV !== "production" &&
    directLocal(req) &&
    !!userId &&
    userId === process.env.FORGE_SETTINGS_ADMIN_ID
  );
}
export function providerStatus(config: Providers, canSaveToServer: boolean) {
  return {
    providers: config.available,
    provider: config.provider,
    modelLabel: config.modelLabel,
    canSaveToServer,
  };
}
