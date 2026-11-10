# Agent core handoff

Update: Milestones 4 and 5 were subsequently authorized and implemented locally. See `MILESTONE_5.md` for the current safety controls, environment variables, test results and gaps; `MILESTONE_4.md` records the earlier memory work. The remainder of this file records the Milestone 3 handoff.

Status: implemented and tested locally on 10 November 2026 in `C:\ai_agent`. Not committed, pushed or deployed. The live website and Merova studio database were not changed. Work stops at Milestone 3.

## Delivered

- Per-chat Agent mode, off by default, saved across reloads.
- Native Anthropic and OpenAI tool calling with streaming public text.
- Web search through a Brave provider interface, public page reading and arithmetic.
- Bounded runs with step, time, token, context, estimated cost and per-user request limits.
- Clear completion, budget, error, step-limit and clarification outcomes.
- Durable runs, tool cards, sources and separately stored full tool results.
- Owner-only access to saved outputs, additive database migration, cancellation and interrupted-run recovery.
- Existing ordinary chat, personal API keys, settings and conversation actions preserved.

## Files

- `docs/CURRENT_STATE.md`: starting architecture audit.
- `docs/research/AGENT_DESIGN_NOTES.md`: research decisions, links and explicit reading coverage.
- `docs/AGENT_DESIGN.md`: implemented architecture, limitations and future milestone design.
- `AGENTS.md`: repository conventions and commands.
- `src/lib/agent/{prompt,types,provider,loop,tools,network,calculator}.ts`: core implementation.
- `src/app/api/chat/route.ts`: agent branch within the existing authenticated stream.
- `src/app/api/conversations/route.ts`: toggle updates and saved run restoration.
- `src/app/api/agent/outputs/route.ts`: owner-checked full output retrieval.
- `src/components/chat-app.tsx`, `src/components/agent-steps.tsx`, `src/app/globals.css`: toggle, streaming activity and responsive tool cards.
- `prisma/schema.prisma`, `prisma/migrations/202611100001_agent_core/migration.sql`: additive agent storage.
- `tests/agent*.test.ts`, `tests/agent-browser.mjs`: loop, network, provider, authenticated-route and browser checks.
- `.env.example`, `package.json`, `package-lock.json`: configuration, test command and dependencies.

Added dependencies: Cheerio parses HTML for readable text extraction; ipaddr.js classifies IPv4 and IPv6 ranges. No agent framework was added.

## Local setup

Keep existing local configuration. Do not overwrite an existing `.env` or copy production database credentials into a disposable test environment.

1. In `C:\ai_agent`, run `npm install`, then `npm run setup` for the local SQLite database.
2. Set either `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` on the server. These variables already existed; agent mode now requires them rather than accepting personal browser keys.
3. Set `AGENT_MODEL_BUDGETS` to a JSON object keyed by each allowed model ID, with numeric `input`, `output` and `context` fields. Input/output are current verified USD prices per million tokens. Context is a token cap. Empty configuration intentionally rejects agent calls. The shape is documented in `.env.example`; do not use test fixture prices for billing estimates.
4. For search, set `AGENT_SEARCH_PROVIDER=brave` and `BRAVE_SEARCH_API_KEY`. Without these, calculator and public page fetch remain usable and search returns a clear unavailable result.
5. Run `npm run dev`, open http://localhost:3000, sign in and choose the configured provider/model in Settings.
6. Turn on Agent mode and try `Calculate (12 + 3) * 4`. Expand the calculator card, read its full output, and reload the chat. Then turn Agent mode off and verify ordinary chat.

New environment variables: `AGENT_MODEL_BUDGETS`, `AGENT_SEARCH_PROVIDER`, `BRAVE_SEARCH_API_KEY`. All are server configuration. No new public key variables exist.

For a later Vercel deployment, configure those values on the separate forgeai project. Its existing `build:vercel` command applies the new additive migration to its Turso database. Preview deployments need their own database. Do not run remote migrations against Merova studio.

## Verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed after fixing the network request's address-family option.
- `npm test`: 42 tests, 40 passed, two existing Docker tests skipped, zero failures.
- `npm run test:browser`: passed ordinary chat signup, settings, streaming, copy, refresh, history, rename, search, retry, stop, deletion and sign-out/sign-in. Desktop and phone accessibility checks passed.
- `npm run test:agent-browser`: passed the real authenticated HTTP flow with a local SDK transport fixture, streamed answer, saved tool output, reload, toggle persistence, and accessibility/overflow checks at 1440 and 390 pixels.
- Real public network smoke check: fetched https://example.com through the pinned-address transport successfully.
- `git diff --check`: passed.

SDK fixtures exercise both Anthropic and OpenAI without paid requests. No live paid model or Brave account was tested. Browser screenshots and temporary test databases are under ignored `.qa` directories. Agent screenshots are in `.qa/agent-browser-1794270440329`; ordinary-chat evidence is in `.qa/browser-1794270221124`.

## Limits and remaining work

- Research covered every supplied abstract page and selected relevant full-text sections, not a full methods review of all 42 papers. Coverage is stated in the research notes.
- Cost is an estimate using owner-configured model prices and a fixed USD 0.01 search reservation. This is not a billing ledger or a guarantee against price changes.
- Context uses a conservative byte-based reservation and stops when full. No automatic compaction or long-term memory is implemented.
- Tools are read-only, but hostile pages can still influence answers or induce public requests. No claim of complete prompt-injection or data-exfiltration prevention is made.
- Fetch supports bounded text/HTML/JSON, not PDF extraction, authenticated pages or JavaScript-rendered sites. Stored full output means the complete bounded extracted result, not unlimited raw page bytes.
- Source links are preserved and the prompt requests claim-level citations. Citation correctness still needs capability evaluation.
- No durable background resume after Vercel terminates a request. Expired runs recover as errors.
- Local Ollama remains available for normal chat, not agent mode.
- M4 through M7 were not started. Recommended order: M4 context compaction and visible memory, M5 stronger safety and explicit confirmations, M6 repeated quality/cost evaluations before broad access, M7 uploads, research and hosted code execution.
