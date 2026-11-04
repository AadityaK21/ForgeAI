# ForgeAI by Merova

A private, account-based full-stack web IDE for founders. The architect plans the data, screens and API. The builder writes the application and checks it before a revision becomes available. The built-in engine compiles interactive React screens against a real SQLite-backed collection API. A Docker container or E2B cloud VM can run generated Node.js and Next.js servers.

## Run locally

Use Node.js 22.13 or newer and npm. Run these commands in the project directory.

```sh
npm ci --yes --no-audit --no-fund
npm run setup
npm run dev
```

Open http://localhost:3000. Create a builder account at **/sign-up** or use **/sign-in** to open an existing workspace. Each account starts with its own project brief. The IDE, file viewer and project database work before provider configuration.

## Models, keys and runtime

1. Sign in and open **Settings / API Keys**. Choose Anthropic, OpenAI or a local Ollama model. The cloud providers support the server's **ANTHROPIC_API_KEY** and **OPENAI_API_KEY**. To use your own key in a signed-in tab, enter it in Settings. Credentials are sent to the same-origin server in headers. HTTPS is required outside localhost. A key entered for that tab is cleared on reload. A provider's first real request checks its credentials and model access.
2. On your own development computer, you can designate an existing builder account with `npm run settings:owner -- owner@example.com` and restart the server. That account can explicitly save keys to the machine's git-ignored **.env.local** from localhost. Those keys become shared server defaults. Hosted accounts can use their individual tab credentials.
3. **ANTHROPIC_MODEL** and **OPENAI_MODEL** override the default cloud models, Claude Sonnet 4.6 and GPT-5.4 mini. The Sonnet 4 snapshot in the original brief was retired in June 2026. [Anthropic model lifecycle](https://platform.claude.com/docs/en/about-claude/model-deprecations). The local server can use an installed Ollama model at its loopback endpoint. Set **MEROVA_LOCAL_MODEL** to its installed name (for example, **qwen3:8b**). An automatic run prefers a model key entered for the tab, then server configuration. The generator uses Anthropic's tool-use API, the OpenAI Responses API, or the configured local model.
4. Select **Plan only** to review a blueprint before code generation. Automatic execution for a new project uses E2B when an **E2B_API_KEY** is supplied, and the built-in engine otherwise. The built-in engine writes isolated revisions under **.sandboxes**, validates the schema and compiles the UI. It serves generated screens in a sandboxed preview with an authenticated, per-project SQLite API. Its fixed runtime supports collection CRUD and custom UI. Choose a VM to run an arbitrary Node backend. Existing built-in projects keep their format on later revisions.
5. Docker requires a running Docker Desktop Linux engine and a direct localhost session. Its workers have no host mounts, Docker socket or provider credentials. An allowlisted package proxy supports Node/Prisma installation. E2B runs cloud microVMs and can use **E2B_TEMPLATE** with Node 20+, npm, Bash and curl. Generated VM databases are temporary, preview URLs expire after approximately 15 minutes, and cloud previews are accessible to anyone with the link. Verified source and revisions remain in the workspace database.

## How generation works

- **Database.** Each User owns private Projects. A Project owns SourceFile records and Run history. A database lease limits the private workspace to one concurrent build. A short transaction publishes all source replacements, the preview URL and the revision together.
- **API.** GET /api/projects lists projects and provider readiness. GET /api/projects?id=... opens a project. POST /api/projects creates one. POST /api/agent accepts projectId, revision, prompt, optional mode (plan or build), and optional engine (auto, instant, local for Docker, or cloud for E2B) and returns newline-delimited JSON events. The latter writes source to its selected worker and streams real verification events.
- **Protocol.** The parser handles tags split across tokens, raw file bodies and CDATA. Use CDATA for code containing literal closing action tags. Complete files precede shell commands. A start command comes last. Streamed drafts become persistent only after verification.
- **Repairs.** The first failed attempt supplies its diagnostic and current files to the model. Up to three repair attempts can replace affected files. Anthropic calls tools to save a structured blueprint, write backend and frontend batches, inspect source, list files and request verification. The other model transports use streamed file actions. A failed revision retains the prior verified version. Terminal output is bounded, provider keys stay in the host environment, and generated shell commands run inside the selected sandbox.
- **Editor.** Monaco assets are served by the app. The browser receives progress events, live code and sandbox logs. Model output is treated as text in the editor and terminal. VM previews run on separate origins. Built-in previews run in an opaque-origin iframe.
- **Review and export.** Open a verified project's Preview, choose Inspect and select an element to try a text or color change. Send the edit to the agent to apply it to the source. The source audit points to files and lines for a small set of security and dependency checks. Download ZIP exports the verified source for editing outside ForgeAI.

## Verification

The workbench opens four tabs: Preview, Code, Data & API, and Terminal. In Code, select a file, edit it and choose **Save & Rebuild**. The last verified version stays available if an edit fails. Use **Data & API** to read project records and send a request to a generated endpoint. The instant engine keeps project data in SQLite under `.sandboxes/<projectId>/`. Back up that directory alongside the builder database. An exported instant project runs independently with `npm install` and `npm start` and creates its own data file.

`POST /api/sandbox` accepts a prompt and an optional project title, or an existing project ID and revision. Send `Accept: application/x-ndjson` for live events. The default response includes source, blueprint, logs, audit and preview. Signed-in project owners can read files with `GET /api/sandbox`, save a verified revision with `PUT /api/sandbox` and download source from `GET /api/sandbox/export?projectId=...`.

```sh
npm test
npm run typecheck
npm run build
```

Tests cover token-by-token parsing, XML delimiters inside source, invalid paths, action ordering, targeted repair and retry exhaustion. A compiler integration test induces TS2322 and checks the corrected file with the real TypeScript compiler.

Set **FORGE_DOCKER_TEST=1** to include the Docker integration test. It exercises file containment, container startup and a real loopback preview.

### Interface regression checks

Start the app, install the Playwright Chromium browser with `npx playwright install chromium`, then run `npm run test:browser`. Alternatively set `CHROME_PATH` to an installed Chrome executable. `BASE_URL` defaults to `http://localhost:3000`. The suite checks the workspace, sign-in and signup at 375, 768, 1280 and 1920 pixels, in both themes and motion preferences, plus accessibility, the guided example, keyboard controls and storage failures.

For account and persistent-file checks, use a separate local server and an empty, dedicated SQLite database. Set that server's `BUILDER_ACCESS_TOKEN` to a test invitation code, then supply the same value as `FORGE_QA_INVITE` and set `BASE_URL` to its loopback URL on a port other than 3000. The suite deliberately creates a disposable account and project. Never run this mode against customer data. Optional `FORGE_QA_SCREENSHOTS` saves screenshots to a chosen directory. `FORGE_QA_ACCOUNT_ONLY` or `FORGE_QA_LIFECYCLE_ONLY` runs a narrower check during debugging.

Design decisions and measured limits are recorded in [DECISIONS.md](DECISIONS.md) and [PROGRESS.md](PROGRESS.md). The final interface pass keeps the existing generation API. The guided example is clearly labelled and does not make a paid model request.

## Private hosting

Run this application on a persistent Node server with a writable SQLite volume and support for streaming requests up to ten minutes. Set **DATABASE_URL** to a persistent SQLite file and **BUILDER_ACCESS_TOKEN** to a long random server-side secret, complete setup, build, then run **npm start** behind HTTPS. The access token acts as a private invitation code during registration. Existing members sign in with their email and password. Passwords are salted and hashed with scrypt. The server stores only the digest of each expiring session token. Production uses a Secure, HttpOnly, same-site cookie and fails closed when the invitation code is absent. Development without an invitation code is intended for the localhost server.

Builder accounts are separate from studio-site Supabase accounts. Public email verification, password recovery, subscription entitlements and usage metering remain prerequisites for a paid public launch. Existing pre-account projects remain on disk without an owner. After the operator creates their account, run `node prisma/assign-legacy.mjs owner@example.com` with the intended account email to explicitly assign only those legacy projects. SQLite on an ephemeral serverless filesystem does not provide durable project storage. The existing Merova site's OpenAI pilot, Supabase credits and project-payment system are separate.
