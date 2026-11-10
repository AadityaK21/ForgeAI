# Milestone 4: context and preference memory

Implemented locally in `C:\ai_agent` following the user's request to continue and their choice to start with preferences only. No production deployment, remote migration or paid model call was performed.

## What changed

Long agent conversations can now use a deterministic extractive summary of older assistant replies. User messages and the six most recent turns stay verbatim. Older questions and explicitly labelled decisions/constraints are also preserved. Each run records a versioned context snapshot with original message IDs, excerpts and before/after byte counts. Expand "Shortened context used for this run" in the chat to inspect it. Original history is never overwritten.

This approach adds no model calls, cost or dependencies. It is deliberately conservative: it does not infer a semantic summary of the entire discussion. If preserved material still exceeds the context limit, the run stops at its existing budget. Mid-run native tool sequences are not rewritten. Unlabelled decisions may be omitted from older assistant excerpts, so the UI invites correction or clarification using the original chat.

Preference memory starts off. Settings & models now includes a Preference memory section with:

- Enable or disable preference memory.
- View, add and edit language, tone and answer-length preferences.
- Delete one preference or all preferences.
- Source and expiry information for each saved preference.

Only fixed category/value pairs are accepted. There is no free-text memory field, and private facts, health details, account numbers, IDs and secrets cannot be saved as preference values. Each preference expires from recall after 180 days and remains visible for renewal or deletion.

The agent has two new tools. `recall_memory` reads only the authenticated user's enabled, unexpired preferences. `save_memory` merely proposes a value and stops for user input. The user must click Save preference in the tool card; the server checks ownership, an exact candidate match, explicit consent and a 24-hour proposal expiry. The model cannot invoke the save endpoint itself. Ordinary chat does not use these tools.

Deleting saved memory stops future database recall. It does not erase past chat messages, saved tool transcripts or a response already in progress. The interface states this and recommends a new chat for clean context. Turning memory off retains visible entries but blocks recall and saves.

## Files

- `src/lib/agent/context.ts`: extractive compaction and versioned snapshot types.
- `src/lib/memory-options.ts`: shared closed preference vocabulary, validation and tool schemas.
- `src/lib/agent/memory.ts`: authenticated preference recall and proposal execution.
- `src/app/api/memories/route.ts`: owner-scoped read, enable/disable, confirmed save/edit and deletion.
- `src/components/memory-settings.tsx`, `src/components/memory-proposal.tsx`: explicit user controls.
- `src/lib/agent/{provider,loop,prompt}.ts`: native tool definitions, proposal stop behavior and prompt rules.
- `src/app/api/chat/route.ts`: compaction before each agent run and stored snapshot delivery.
- `src/components/{chat-settings,agent-steps}.tsx`, `src/app/globals.css`: memory and context UI.
- `prisma/schema.prisma`, `prisma/migrations/202611100002_context_memory/migration.sql`: opt-in flag, preference records and context snapshot.
- `tests/context.test.ts`, `tests/memory.test.ts`, `tests/agent-route.test.ts`, `tests/agent-browser.mjs`: coverage for the new behavior.

## Try it locally

1. Run `npm run setup`, then `npm run dev` in `C:\ai_agent`.
2. Sign in and open Settings & models. Enable Use preference memory.
3. Choose a preference type/value and click Save preference. Edit it, close and reopen Settings, then delete it to check persistence.
4. With the existing server model credentials and model budget configured, enable Agent mode and ask: "Please remember I prefer a friendly tone."
5. Expand the save memory card. The preference is not saved until you click Save preference. Verify it in Settings.
6. Ask the agent to recall your saved preferences. Disable or delete memory, then use a new chat to verify that it is no longer recalled.

No new environment variables or dependencies are needed. Existing agent credentials and budgets still apply. The database changes are additive. The existing Vercel migration command will apply them only when a later deployment is requested.

## Validation

Unit and authenticated route tests cover opt-in, explicit consent, invalid/private values, cross-account isolation, proposal mismatch and expiry, preference expiry, edits, disabled recall and deletion. Context tests check unchanged user/recent messages, preserved marked decisions, unchanged original records, size reduction and saved snapshots restored through the real conversation route. Browser tests exercise the production build with a local provider transport fixture, not a paid model account.

Results: production build passed. The full test suite passed 44 tests with two existing Docker skips and no failures. The expanded authenticated compaction route test also passed. Both browser suites passed, including accessibility checks for memory on mobile. Agent evidence is in `.qa/agent-browser-1794271200113`; ordinary-chat evidence is in `.qa/browser-1794271200114`. The local SQLite schema was updated successfully; production storage was untouched.

M5 safety/confirmations, M6 quality evaluations and M7 uploads/research/sandbox work remain out of scope. General-purpose free-text memory is also out of scope by the user's choice.
