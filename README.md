# Merova AI

A minimal conversational assistant, evolved from the ForgeAI repository. Next.js 15, React 19, TypeScript, Prisma 6, and a dedicated Turso database in production. Local development uses SQLite. The current working checkout is `C:\ai_agent`.

## Local development

Use Node.js 24 and npm:

```sh
npm ci --no-audit --no-fund
npm run setup
npm run dev
```

Open http://localhost:3000. Sign up at `/sign-up` and sign in at `/sign-in`. Set a private `BUILDER_ACCESS_TOKEN` in `.env.local` if invitations should also be required locally. Never commit private environment files.

## AI configuration

Sign in, open **Settings & models**, choose Anthropic or OpenAI, enter a provider key, and click **Load available models**. Select a model returned by the provider, then **Apply settings**. Keys stay in tab memory, are passed in same-origin HTTPS request headers and clear on refresh/sign-out. The chat interface never writes them to browser storage, database records or environment files.

For a shared provider, set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the server environment. Existing optional model overrides `ANTHROPIC_MODEL` and `OPENAI_MODEL` still apply. `MEROVA_LOCAL_MODEL` supports an installed Ollama model on the server at `127.0.0.1:11434`; it does not connect to a hosted visitor's own computer. E2B is not required for conversations.

The OpenAI adapter sends conversation turns to the Responses API with `store: false`. Anthropic uses streamed Messages. Conversation content is sent to the selected provider and saved to Merova AI's database. Provider policies still apply; `store: false` is not a promise of zero provider retention.

## Features

- Empty chat centered composer; active conversations use a bottom composer.
- Streaming replies, stop, interrupted-response recovery and retry of the latest failed reply.
- Persistent account-owned history, search, rename, delete, and direct `/?chat=...` links.
- Markdown, lists, tables, code blocks, code/message copying and multilingual text direction.
- Responsive mobile drawer, keyboard navigation, native focus-trapped dialogs and reduced-motion support.
- Enter sends, Shift+Enter adds a newline, Ctrl/Cmd+K searches, Ctrl/Cmd+Shift+O starts a new chat.
- Server-side validation, owner checks, durable per-account rate limits, same-origin session protection, bounded context and concurrent-generation leases.

## Storage and API

`Conversation` belongs to `User`; `ChatMessage` belongs to `Conversation`. The additive `202611080001_conversations` migration preserves all previous users and builder project data.

- `POST /api/chat`: authenticated streaming NDJSON response.
- `GET /api/chat/models`: provider model discovery using server or tab credentials.
- `GET /api/conversations`: paginated history or one conversation; optional `q`, `offset`, `id`.
- `PATCH /api/conversations`: rename an owned conversation.
- `DELETE /api/conversations`: delete an owned conversation and its messages.
- Existing `/api/auth/*`, `/api/settings` and `/api/health` remain in use.

The builder UI, decorative illustrations, old fonts, theme controls and demo are removed. Legacy project APIs and engine modules remain to preserve stored projects and compatible integrations, but are not part of the chat UI. No destructive data migration is performed.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:browser
```

The browser suite uses installed Google Chrome and starts its own production app on port 3002 and a clearly isolated Ollama protocol fixture on port 11435. It uses a disposable `.qa` database. These fixtures test actual routes, database persistence and streaming UI without buying model tokens. They are never used by the deployed application. Paid-provider replies require separately configured credentials and are not claimed tested by fixture runs.

## Deployment and limitations

See `DEPLOYMENT.md`. The Vercel project remains `forgeai`, its GitHub production branch remains `main`, and the public URL remains https://forgeai-one-zeta.vercel.app. The Merova studio website and its database are unrelated and untouched.

This is an invitation-only pilot. Account recovery and verification emails, subscriptions, attachments, web browsing and tool execution are not implemented. Chat has a 16,000-character input limit, 100,000-character conversation context limit, 200-message limit, 30 requests per account per ten minutes and a 150-second response timeout. API keys and model selections in Settings reset on refresh. A provider subscription alone may not include API credit.
