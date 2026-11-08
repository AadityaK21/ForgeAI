# Merova AI deployment

Production URL: https://forgeai-one-zeta.vercel.app
Vercel team: `merova2`; project: `forgeai`.
GitHub: `AadityaK21/ForgeAI`; production branch: `main`.
Local checkout: `C:\ai_agent`.

The application name is Merova AI. Hosting and environment identifiers retain their existing names so the separate Merova studio project is never modified.

## Required Production environment

- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`: provided by the dedicated Turso integration connected only to this project.
- `DATABASE_URL=file:./dev.db`: Prisma schema-tooling fallback; runtime uses Turso.
- `BUILDER_ACCESS_TOKEN`: private invitation, random and at least 32 characters.
- `FORGE_PUBLIC_ORIGIN=https://forgeai-one-zeta.vercel.app`: exact origin.
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`: optional shared provider credential. Without either, signed-in users must supply a personal key in Settings. Optional `ANTHROPIC_MODEL` or `OPENAI_MODEL` chooses the shared default.

Never use `NEXT_PUBLIC_` for secrets. Never commit pulled environment files. A production key is not required for building the app, but a provider key is needed for cloud AI replies.

## Release

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run test:browser`. Push reviewed changes to `main`; the existing GitHub connection deploys automatically. Vercel uses `npm run build:vercel`, which validates configuration, applies checksum-tracked additive Turso migrations, generates Prisma and builds Next.js. Use Node 24.

Verify `/api/health`, sign-in, existing user persistence, chat history, model settings and the live layout after deployment. Production provider calls incur charges and should be separately exercised with an authorized API key. Migration `202611080001_conversations` only adds conversation tables and indexes; old accounts and project tables are retained.

Preview branches require their own database, invitation and origin, plus `FORGE_DATABASE_ENV=preview`. Do not connect a preview to the production database. Do not modify `merova.app`, the Merova studio Vercel project, or its Supabase database.

The private pilot still requires invitations and does not include account-recovery emails, subscriptions or unrestricted public registration. Vercel function duration for chat is 180 seconds; the provider request stops after 150 seconds and saves partial replies. Check hosting billing and provider quotas if requests are restricted.

## Persistent Node alternative

Keep the existing `npm run start:hosted` workflow for a server with persistent storage. Use an absolute `FORGE_DATA_DIR` and a SQLite `DATABASE_URL` inside that directory. Set the same origin and invitation variables, and leave Turso variables unset. Back up the database and legacy project directories. Never reset an existing database to resolve a migration mismatch.
