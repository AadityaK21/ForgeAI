# ForgeAI deployment

ForgeAI has its own Vercel project, `merova2/forgeai`, connected to `AadityaK21/ForgeAI`. Use `main` as the production branch. Its assigned address is `https://forgeai-one-zeta.vercel.app`; the shorter requested address is already assigned to another project. The studio site and its Supabase database are separate.

## Vercel

Use Node 24.x and Fluid compute. `vercel.json` supplies the install/build commands and Mumbai region. The build checks server configuration, applies versioned, checksummed Turso migrations without resetting data, generates Prisma Client, then builds Next.js. The Pro account supports the existing 600-second build routes. Configure these variables for **Production** on **ForgeAI only**:

| Variable | Value |
| --- | --- |
| `TURSO_DATABASE_URL` | Supplied by the dedicated `forgeai-db` integration |
| `TURSO_AUTH_TOKEN` | Supplied by that integration; secret |
| `DATABASE_URL` | `file:./dev.db`, used only by local Prisma schema tooling |
| `FORGE_PUBLIC_ORIGIN` | `https://forgeai-one-zeta.vercel.app` |
| `BUILDER_ACCESS_TOKEN` | Random invitation code, at least 32 characters; secret |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Optional server model default; members can instead enter a request-scoped key in Settings |
| `E2B_API_KEY` | Optional cloud VM runtime; the built-in compiler does not require it |

Do not set `FORGE_DATA_DIR` on Vercel. Turso stores accounts, sessions, source, verified previews and generated collection records. The local compiler uses disposable OS temporary storage and removes its successful build cache. Tests verify a preview and its records remain available after that cache is removed. Generated arbitrary Node.js servers run in E2B, not in a Vercel process. Model and E2B keys are never committed or delivered to generated applications.

Preview branches deliberately fail configuration checks unless connected to their **own** database with `FORGE_DATABASE_ENV=preview`, their own invitation, and their exact HTTPS origin. Never connect preview deployments to production storage. The production URL is publicly reachable, but workspace registration remains invitation-only. Email verification, recovery, subscriptions and usage metering are not enabled by this deployment.

`GET /api/health` checks database connectivity without exposing data. For a release, run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`; then push to `main`. Inspect Vercel's build result and smoke-test authentication, project editing and preview data. Keep any pulled `.env` files private. Back up the dedicated database through Turso before applying future destructive schema changes. The current migrations only create tables and indexes.

## Persistent Node server alternative

Set `FORGE_DATA_DIR` to an absolute persistent directory, `DATABASE_URL` to an absolute SQLite file inside it, `FORGE_PUBLIC_ORIGIN` to its HTTPS origin and `BUILDER_ACCESS_TOKEN` to a random secret of at least 32 characters. Build, then run `npm run start:hosted` behind HTTPS. This creates the storage directory, applies migrations and starts the server. Leave Turso variables unset to use local SQLite. Back up the entire data directory, including its `projects` subdirectory.

Existing databases created with `db push` require a reviewed migration baseline. Never reset an existing database to bypass a migration error. Local development retains its existing database and `.sandboxes` folder.
