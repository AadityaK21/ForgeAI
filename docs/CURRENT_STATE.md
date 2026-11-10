# Merova AI before agent mode

Audit: 10 November 2026. Repository: `C:\ai_agent`, GitHub `AadityaK21/ForgeAI`. This describes the starting point, before Milestone 3 changes.

## Stack and deployment

Next.js App Router 15.5.28, React 19, TypeScript 5.9, Tailwind 3, Prisma 6.19.3, Zod 4. Native Anthropic and OpenAI SDKs serve model requests. Markdown uses react-markdown and remark-gfm. The independent Vercel project is `forgeai`, team `merova2`, production branch `main`, Node 24. Its public URL is https://forgeai-one-zeta.vercel.app. Merova's studio website and database are separate and must not change.

Vercel runs `build:vercel`: validate deployment settings, apply checksummed SQL migrations to Turso, generate Prisma, build Next.js. Turso uses the libSQL Prisma adapter. Local development uses SQLite. A production deployment without remote database configuration fails closed. Local SQLite files cannot provide durable Vercel storage.

## Chat request flow

`src/components/chat-app.tsx` loads the session, settings and conversation history. Its composer posts to `/api/chat` with a UUID request ID, selected model, optional conversation ID and request-scoped personal provider credentials. It consumes newline-delimited JSON: start, delta, done, error. Stop aborts the request. Markdown renders text without raw HTML.

`src/app/api/chat/route.ts` validates JSON and authenticates the session. A transaction checks ownership, rate limits, duplicate requests and context size, obtains a conversation lease, and inserts the user's message and an empty assistant message. The route calls `chatText` in `src/lib/chat-provider.ts`. That adapter streams native Anthropic Messages, OpenAI Responses or local Ollama. Text is periodically persisted. Completion, cancellation and failures save the final status and release the lease. Interrupted messages remain distinguishable from complete answers and can be retried.

`/api/conversations` lists, searches, loads, renames and deletes owned conversations. It recovers messages left streaming after a lease expires. The client restores history on reload and polls when another request is still running.

## Data and authentication

`prisma/schema.prisma` defines User, Session, AuthAttempt, Conversation and ChatMessage. User email is unique. Passwords use scrypt. Session tokens are hashed in storage; browser cookies are HttpOnly, SameSite=Lax and Secure in production. Registration requires the configured invitation in production. Origin checks and ownership checks live in `src/lib/access.ts`. Conversation deletion cascades to messages. Message request IDs are unique within a conversation. AuthAttempt supports durable shared rate limits.

Legacy Project, SourceFile, Run, PreviewAsset, CollectionState and ProjectRecord tables and builder APIs remain for compatibility. The legacy Run table is not a chat agent run.

## Model settings

`src/lib/providers.ts` resolves the chosen provider and model. Normal chat accepts tab-memory personal keys or server `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. Settings lists available models. Ollama is restricted to a configured loopback port and installed model. The previous user preference was to keep personal keys. The new agent request explicitly requires environment-only secrets, so that restriction should apply to agent mode without removing ordinary chat's personal-key flow.

## Fragile areas

- Long-running work must finish within Vercel's request duration. There is no background worker or durable resume.
- Model context is currently bounded by message count and characters, not provider tokenization.
- Database migrations run during production builds. Preview deployments must not point at the production database.
- Existing tests cover SDK transport fixtures and local Ollama, not paid cloud account availability.
- No agent tools, long-term memory, confirmation flow or quality benchmark existed at this audit. A prompt alone cannot guarantee resistance to hostile web content.
