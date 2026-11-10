# Merova AI agent core

Scope: Milestones 0 to 5. The user approved Milestone 5 safety hardening after Milestone 4 and retained preference-only memory on 10 November 2026. The research decisions in `research/AGENT_DESIGN_NOTES.md` drive this implementation.

## Loop and provider boundary

The existing authenticated `/api/chat` route branches only when Agent mode is enabled. The setting is persisted on Conversation and starts false. Normal chat keeps its existing adapter, events and personal-key behavior. Agent mode has a thin native SDK adapter in `src/lib/agent/provider.ts`, selected by the same provider/model settings but using environment credentials only. Anthropic Messages and OpenAI Responses support structured tool calls. Local Ollama is not enabled for agent mode in this release.

One model chooses an action, the registry validates and executes it, and the model receives a labelled untrusted observation. Public text streams through message_delta; private reasoning is not displayed. There are no automatic SDK retries. Failed tools return short, recoverable errors. `ask_user` is a control action that stores the question and terminates the run.

Limits are enforced by code: 12 model rounds and at most 12 tool calls, 120 seconds, 60,000 cumulative input/output tokens, a context ceiling of the smaller of 32,000 and the configured model budget, estimated USD 0.50, and configurable per-user minute requests and UTC daily new runs (defaults five and thirty). The existing 30-message chat limit also applies. Requests share the conversation lease. Stop reasons: done, step_limit, budget, error, needs_user_input. User cancellation is budget with a stopped message. Process termination is recovered as error after the lease expires.

Before each model call, UTF-8 input bytes plus a framing allowance reserve a conservative input-token bound, and output tokens are reduced to fit remaining context, run tokens and cost. Actual provider usage settles the estimate. An interrupted call without usage charges its full reservation in the run record. Unknown/unpriced models are rejected. The owner supplies verified USD input/output prices per million tokens in `AGENT_MODEL_BUDGETS`; this is not a pricing database. Search reserves USD 0.01 per attempt. Estimates depend on correct configured prices and do not include infrastructure charges. A durable UTC daily spend ledger reserves the full per-run budget before paid work. Monthly billing and infrastructure costs are not tracked.

## Registry and networking

Every tool includes a model-facing description with when to use it, exclusions, input example, result shape, Zod-generated JSON schema, timeout, output cap and side-effect class. Unknown or non-read-only tools are refused. Arguments are validated before execution.

| Tool | Behavior | Limits |
| --- | --- | --- |
| web_search | Provider interface, first adapter Brave, selected by AGENT_SEARCH_PROVIDER | Five results, 12 seconds, 500 KB response, 6,000 model characters |
| fetch_url | HTML/plain-text public page, Cheerio removes non-content elements | 12 seconds, four redirects, 1 MB received, 100,000 extracted characters, 6,000 model characters |
| calculator | Recursive arithmetic parser, no eval, variables or code | 500 input characters, 200 tokens, 1 second, finite floating-point result |

fetch_url accepts only HTTP(S), no credentials, and standard ports. It rejects loopback, private, link-local, reserved, multicast and mapped private addresses. Every DNS answer must be public. The socket lookup is pinned to one validated address while preserving Host and TLS hostname verification. Every redirect repeats validation and pinning. No cookies, user credentials or authorization headers are forwarded. Compressed and non-text pages are refused. Search uses a fixed HTTPS provider host and refuses redirects.

## Events, UI and storage

The existing NDJSON start/done envelope remains. Agent events are typed as plan, tool_call, tool_result, message_delta, final and error. They include message/run identifiers at the route boundary. The public plan is transient; steps and final run status are durable. Native details elements give keyboard-accessible collapsible tool cards and wrap at phone widths. Source links use HTTP(S), a new tab and noreferrer. The prompt requires claim-level citations; the runtime also appends sources actually returned by tools. That list proves consultation, not factual support for every claim.

Conversation -> ChatMessage -> AgentRun -> AgentStep -> AgentOutput. A retry creates a new run rather than overwriting earlier steps. A step is inserted before execution as incomplete, then updated with the result. AgentOutput stores the complete bounded tool result separately; AgentStep stores its preview and source URLs. Model observations receive only trimmed output and a saved step ID. An owner-checked `/api/agent/outputs?id=...` endpoint allows the UI to read the saved full result. Full outputs are not automatically loaded into later model requests. Deleting the conversation cascades through all agent data. Abrupt failure can leave incomplete steps, not falsely successful ones.

## Context and memory, Milestone 4

Before each agent run, compactHistory checks the history against a conservative model-context allowance. Above 80% of the history allowance, it shortens older assistant replies to labelled extracts. All user messages, the six most recent turns, and older assistant lines containing questions or explicit decision/constraint markers are preserved verbatim. The system prompt and current-run tool protocol are untouched. A versioned snapshot records each shortened message ID, the exact excerpt and before/after byte counts on AgentRun. The UI exposes that snapshot. Original messages remain unchanged. Users correct missing context with a follow-up or by pasting the original passage.

This is deterministic extractive compaction, not a model-generated semantic summary. It requires no extra provider call or cost. Unlabelled decisions can be missed, and some histories remain too large; the existing hard budget then stops the run. Compaction happens between runs, not in the middle of native tool-call sequences. Tool outputs still use bounded excerpts with stored full-output references.

Memory is deliberately limited to the user-approved closed list of language, tone and response-length preferences. It is off by default. Settings allows opt-in, view, add, edit, individual deletion and deletion of all preferences. Each saved value has a source, timestamps and a 180-day expiry. Expired entries remain visible but are not recalled. Saving a value again renews it. At most one value per category is stored.

recall_memory queries only the authenticated owner and checks that memory is enabled and not expired. save_memory pauses with needs_user_input before mutation. Its card shows the closed-set value and Approve/Deny. Approval resumes that exact call once; denial returns an observation without executing. Both resume the same native provider transcript and cumulative budget. The older proposal-saving POST path is rejected. Manual Settings saves remain explicit clicks. Both save paths return an Undo token valid for 24 hours, bound to owner and saved revision. Undo restores the previous value or removes a new value without overwriting a later edit. Turning memory off blocks future recall and saves.

Free text cannot enter preference storage. Unknown categories, mismatched values and extra fields are rejected. This excludes health details, accounts, government IDs and secrets structurally, rather than relying on a keyword filter. A deleted preference is absent from future database recall, but past chat messages and already-running requests are not erased. The UI tells the user to start a new chat for clean context. Ordinary chat does not call memory tools.

## Safety, confirmations and limits, Milestone 5

Every observation is escaped into a labelled untrusted_tool_data block. The prompt treats tool results and recalled memories as data, never instructions. A deterministic side-effect gate pauses writes before execution; currently the only enabled write capability is a closed-set preference save. Future tools must explicitly declare their side effect, implement an approved executor and provide a confirmation summary. Unknown capabilities fail closed. No shell, payment, email or account-change action is exposed.

Web fetch/search permanently taints the current run before access, including failed attempts. The checkpoint persists taint, native protocol, pending exact call, counters, limits and consulted sources. Approval is authenticated and bound to step, owner and run, expires in one hour or at UTC midnight, and is atomically consumed with a conversation lease. It cannot change the arguments or authorize subsequent calls. Deny is a normal observation. Expired or replayed decisions fail with a friendly message. Paused native transcripts are server-only, never returned by conversation APIs.

Per-user minute requests and UTC daily new runs use durable counters shared across instances. Signed-out users cannot use agent mode. Per-run tokens and estimated cost are configurable. Global daily spend atomically reserves the full run allowance; known terminal usage releases unused budget once. Pauses, crashes and uncertain usage conservatively hold their reservation until the day ends. Resume consumes the same allowance, never a fresh one. A kill switch is checked before initial requests, resumes, model calls and tool calls. Hosted environment changes require deployment and do not retroactively cancel a request already sent to a provider.

AgentAudit records lifecycle events for every processed tool call: internal user/run IDs, tool, fully redacted argument values with byte count, result bytes, duration and status. No result text, email, URL, preference value or secret is stored in audit. Started without a terminal event means interrupted, not successful. Only IDs in AGENT_ADMIN_USER_IDS can access the authenticated, uncached latest-100 audit endpoint. Ordinary users see only their own normal activity cards. Audit rows deliberately survive chat deletion; retention cleanup is an operator responsibility. Checkpoints, steps and reservations cascade with chat deletion, but spend ledger totals never reset on deletion.

The fetcher permits text/html and text/plain only. It repeats URL and all-address DNS validation on each redirect, pins the validated IP, preserves TLS hostname verification, caps four redirects, 1 MB and 12 seconds across DNS and response, and rejects compression. HTML is never rendered as raw tool content.

This is not full information-flow security or injection immunity. Hostile text may still influence answers or induce public search/fetch requests, including query disclosure. There are no sensitive document, mailbox or payment tools. Labels and sanitization supplement the execution gate. Deterministic fixtures test attempts to bypass it, not real-model robustness or broad adaptive benchmark performance.

## Evaluation and multi-agent work

Single agent first. A later parallel research worker could investigate independent public sources, but only with bounded per-worker budgets and one evidence merger. Extra agents introduce coordination failures and cost without evidence of benefit here.

Milestone 6 should add 20 to 40 versioned tasks: lookups, multi-hop research, calculations, ambiguity and injected pages. Use deterministic tool fixtures, separate held-out tasks, repeated seeds and human-reviewed correctness criteria. Report success rate, pass^k across repeated trials, source support, forbidden action rate, steps, tokens, latency and estimated cost. Treat refusal, interruption and unavailable sources as distinct outcomes. Compare with ordinary chat and a simple one-call baseline. No benchmark claims follow from unit tests.

Milestone 5 is implemented locally. Next is M6 quality evaluation before broad access, then M7 uploads/retrieval, deep research and isolated hosted code execution. M6 and M7 are not part of this change.
