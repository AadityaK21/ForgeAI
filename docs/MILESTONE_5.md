# Milestone 5: safety, confirmations and abuse limits

Implemented locally on 10 November 2026 in `C:\ai_agent`. Built on the existing M0 through M4 work without replacing it. No commit, push, production deployment, remote migration or paid model call was made. Merova studio and its database were not changed. Work stops at M5.

## What was built

- All tool observations, including recalled memories and approval/denial results, use escaped data-only envelopes. The system prompt explicitly rejects instructions in them.
- Web search/fetch taints the run before access. Taint survives stored checkpoints and resumes. All writes require consent even before taint; read-only tools remain automatic.
- Durable one-call confirmations with visible tool name, exact closed preference arguments in plain language, Approve/Deny, expiry, ownership and replay protection. The server ignores model claims of approval. It resumes the same native Anthropic/OpenAI transcript, token/cost counters and tool/round caps. Denials become observations. The older proposal-save route is closed.
- Preference saves show a Saved to memory chip and Undo. Undo is owner-bound, single-use, valid for 24 hours, and refuses to overwrite a later edit. It removes a new preference or restores the prior value. Manual Settings saves also support Undo.
- Public fetch permits only HTML and plain text, with four redirects, 1 MB and 12 seconds across DNS and response. Every redirect repeats all-address DNS validation and uses a pinned public IP. Compression, private IPs, mixed private/public DNS answers and unsupported content types fail closed.
- Durable per-user fixed-minute request and UTC daily new-run limits. Signed-out users cannot start or resume an agent run. Per-run token/cost caps are configurable. Existing normal-chat limits remain.
- Global UTC daily spend reservations before paid work. Concurrent requests cannot reserve beyond the cap. Terminal known usage releases unused budget once. Pauses, clarification stops, crashes and uncertain usage conservatively retain the full reservation for that day. Resumes consume the same budget. Runs are aborted at the UTC boundary before starting work on a new day's allowance.
- Agent kill checks before initial requests, resume, model calls and tool calls. The kill switch does not disable normal chat.
- Admin-only audit endpoint with internal user/run IDs, tool, fully redacted argument values plus byte count, result size, duration, status and timestamp. Unknown tool names are redacted too. No raw tool results or personal argument values go into audit storage. Started and terminal events make interrupted calls distinguishable from completed calls.

## Files changed in M5

Core:
- `src/lib/agent/safety.ts`: policy, envelopes, configuration validation and redaction.
- `src/lib/agent/usage.ts`: durable request counters, atomic daily reservations, idempotent settlement and UTC lifetime signal.
- `src/lib/agent/persistence.ts`: checkpoint, step and audit persistence.
- `src/lib/agent/memory-write.ts`: transactional preference mutation and revision-bound Undo record.
- `src/lib/agent/loop.ts`, `types.ts`, `provider.ts`, `prompt.ts`: gating, native transcript snapshot/resume, taint, cumulative budgets and tool-data instructions.
- `src/lib/agent/network.ts`: MIME restriction and total request timeout, retaining redirect/DNS/IP pinning.

API and database:
- `src/app/api/chat/route.ts`: reserve usage before streaming, persist pauses and settle completed runs.
- `src/app/api/agent/confirmations/route.ts`: owned confirmation status and single-use decision/resume stream.
- `src/app/api/agent/audit/route.ts`: authenticated admin-only latest-100 audit records.
- `src/app/api/memories/route.ts`, `src/app/api/memories/undo/route.ts`: explicit Settings saves, legacy proposal rejection, safe Undo.
- `prisma/schema.prisma`, `prisma/migrations/202611100003_agent_safety/migration.sql`: additive checkpoint, confirmation, spend, reservation, audit and Undo tables.

UI:
- `src/components/memory-proposal.tsx`, `memory-undo.tsx`, `memory-settings.tsx`, `agent-steps.tsx`, `chat-app.tsx`, `src/app/globals.css`: visible approval cards, resume refresh, memory chips, accessible controls and mobile layout.

Tests and documentation:
- `tests/agent-safety.test.ts`, `agent-confirmations.test.ts`, `agent-network.test.ts`: injection classifications, staged attempts, approvals, ownership, Undo, limits, kill switch, concurrency, rebinding and MIME/time bounds.
- `tests/agent-provider.test.ts`, `agent-route.test.ts`, `memory.test.ts`, `agent-browser.mjs`: native transcript restoration and updated route/browser coverage.
- `.env.example`, `AGENTS.md`, `docs/AGENT_DESIGN.md`, `docs/research/AGENT_DESIGN_NOTES.md`, `docs/AGENT_HANDOFF.md`, this report.

Earlier M0 through M4 changes remain uncommitted in this checkout. The Git status also includes those earlier changes; they were preserved.

## New environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| AGENT_DISABLED | false | Any nonempty value other than false disables agent mode. |
| AGENT_REQUESTS_PER_MINUTE | 5 | New-run and confirmation-resume requests per user per fixed minute. |
| AGENT_RUNS_PER_DAY | 30 | New agent runs per user per UTC day; resume is not another run. |
| AGENT_MAX_TOKENS | 60000 | Cumulative input/output token allowance for one run, including resumes. |
| AGENT_MAX_COST_USD | 0.5 | Estimated USD cap per run. |
| AGENT_DAILY_SPEND_USD | 10 | Global estimated daily budget, including active reservations. |
| AGENT_ADMIN_USER_IDS | empty | Comma-separated internal User IDs allowed to read audit logs. Empty denies everyone. |

Positive finite limits are required. Upper bounds: 1,000 requests/minute, 10,000 runs/day, 1,000,000 tokens/run, USD 100/run and USD 2,000/day. Invalid configuration fails closed. Fractional count settings are rounded down. Existing `AGENT_MODEL_BUDGETS`, server provider credentials, and optional Brave settings are still required for actual agent use. No new package dependency was added in M5.

Vercel environment changes need redeployment. A request already sent to a provider cannot be retroactively cancelled by changing a deployment variable. Cost estimates depend on correctly configured model prices and the existing USD 0.01 search allowance. They exclude infrastructure, taxes and any provider price mismatch. Set provider-side billing limits as well when enabling paid access.

## How to test

Run locally:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:browser
npm run test:agent-browser
```

Do not run dev and build against the same `.next` directory simultaneously. Browser suites start isolated fixture servers and temporary databases. They do not call paid providers.

Manual UI check with a configured server model:
1. Sign in, enable preference memory in Settings, and enable Agent mode for a conversation.
2. Ask it to remember a supported preference. It must stop with needs user input and show Approve/Deny before saving.
3. Deny once and check it resumes without saving. Try another request, approve it, and check the saved chip and Undo. Reload to verify persisted action status.
4. Read a public page in an agent run and request a preference save. The confirmation must show the web-content warning. A second write needs a new approval.
5. Set low limits or the kill switch in a local test process and verify the friendly refusal. Restore normal settings afterwards. Only an allowlisted User ID may GET `/api/agent/audit`.

The local SQLite schema was updated with `prisma db push --skip-generate`. The additive SQL migration was exercised by the existing libSQL migration/restart test. No remote database was touched.

## Validation results

- Lint: passed, no warnings.
- Typecheck: passed.
- Unit/integration suite: 53 tests, 51 passed, 2 existing optional Docker tests skipped, 0 failed.
- Additional Anthropic snapshot/restore fixture: passed.
- Production build: passed, all routes compiled.
- Ordinary-chat browser suite: passed signup, settings, streaming, markdown, copy, refresh/history, rename/search, retry/stop, deletion, sign-out/sign-in and desktop/mobile accessibility.
- Agent browser suite: passed saved output and mode persistence, memory opt-in/edit, pause, Approve, Deny, resume, Undo, deletion/reload, and zero tested accessibility violations at 1440px and 390px.
- No em dash characters found in src, tests or docs.
- Initial browser test waited for a transient post-resume notice; the conversation refresh replaces that notice. The test now checks durable action and run status, and passes.

Local evidence:
- `.qa/m5-tests-final.log`, `.qa/m5-build-final.log`, `.qa/m5-chat-browser.log`, `.qa/m5-agent-browser-final.log`.
- `.qa/browser-1794274957164` and `.qa/agent-browser-1794275048180` contain browser evidence. Confirmation screenshots include 1440px and 390px.

Injection fixtures explicitly record system outcome, mocked-model behavior where applicable, task completion, tokens and estimated cost. Three attack scenarios (direct memory instruction, staged pages, forged boundary/approval) force the mocked model to attempt a write: model outcome obeyed, system outcome refused at the confirmation boundary, zero writes, task completion false while paused. Separate ignored and explicit-refusal fixtures complete the benign calculation. These labels do not claim a real model recognized the injection.

## Research applied and skipped

All 13 requested arXiv abstract pages were opened with internet access. Eight lesson -> decision -> source entries are in `research/AGENT_DESIGN_NOTES.md`.

Applied: AgentDojo/InjecAgent/ASB tool-output threat tests plus benign utility; CaMeL and adaptive-defense work's principle of enforcement outside the model; RTBAS selective confirmation; staged-injection taint persistence; memory trust boundaries and controlled writes; Firewalls/landscape boundary validation; Ignored, Not Refused outcome distinctions; cost accounting and reliability bounds.

Skipped: full CaMeL information-flow architecture, RTBAS dependency screeners, PAA auditor, MemGate neural filtering, learned sanitizers, model training and broad adaptive benchmark reproduction. They exceed this preference-only milestone and need separate evaluation. Abstract review was not full-paper review; no paper's headline security numbers are claimed for Merova AI.

## Known gaps

- Prompt injection can still affect answers or public search/fetch arguments, including query disclosure. This is not full confidentiality-flow enforcement or injection immunity. Sensitive-document, mailbox, payment and shell tools remain unavailable.
- Actual paid Anthropic/OpenAI and Brave behavior was not exercised. Tests use deterministic native SDK fixtures, not model capability benchmarks.
- Only preference saving currently has an approved write executor. Future side-effect tools require an explicit executor, validation, confirmation presentation and tests; they do not inherit automatic authority.
- Interrupted or paused runs can conservatively consume their full daily reservation until UTC reset. This favors bounded spending over maximum availability.
- Audit values are completely redacted, which limits debugging. Audit rows survive chat deletion and currently require operator-managed retention. Expired checkpoint/Undo rows remain until parent deletion or operator cleanup; no scheduled retention job was added.
- Deleting memory does not erase old messages or already-issued model context. User-requested Undo will not overwrite subsequent edits.
- M6 quality evaluation and M7 integrations are not started. Nothing was published.
