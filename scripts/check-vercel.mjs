const required = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "BUILDER_ACCESS_TOKEN", "FORGE_PUBLIC_ORIGIN"];
const missing = required.filter(key => !process.env[key]?.trim());
if (missing.length) throw Error("Configure ForgeAI environment variables: " + missing.join(", "));
if (!process.env.TURSO_DATABASE_URL.startsWith("libsql://")) throw Error("Vercel requires a remote Turso database.");
if (process.env.BUILDER_ACCESS_TOKEN.trim().length < 32) throw Error("Use a random invitation code of at least 32 characters.");
const origin = new URL(process.env.FORGE_PUBLIC_ORIGIN);
if (origin.protocol !== "https:" || origin.origin !== process.env.FORGE_PUBLIC_ORIGIN)
  throw Error("FORGE_PUBLIC_ORIGIN must be the exact HTTPS origin, without a trailing slash.");
if (process.env.VERCEL_ENV === "preview" && process.env.FORGE_DATABASE_ENV !== "preview")
  throw Error("Preview deployments require a separate preview database with FORGE_DATABASE_ENV=preview.");
console.log("ForgeAI production configuration checked.");
