# Agent design notes

Research pass: 10 November 2026. Internet access was available. All supplied arXiv abstract pages were opened, along with the three practical guides. This was a bounded implementation-oriented review, not a full-paper literature review. ReAct's action-space/method sections, InjecAgent's threat construction, CaMeL's design and tau-bench's task/evaluation sections received additional HTML reading. Other papers were reviewed at abstract/takeaway level. The source inventory below makes that coverage explicit. Background training and later-milestone papers are not evidence that their techniques were implemented here.

The decisions below are our engineering choices informed by the sources, not claims that the papers prescribe these exact limits.

## Loop

- Interleave decisions with observations -> native tool-call loop, with each result returned before the next decision -> [ReAct](https://arxiv.org/abs/2210.03629).
- Reflection can help recovery but also adds work -> let the next bounded turn recover from a clear tool error, with no recursive critic or unbounded retry -> [Reflexion](https://arxiv.org/abs/2303.11366).
- Search trees are more complex than one trajectory -> defer LATS; separate prompt, tools, provider and persistence using CoALA's useful conceptual split -> [LATS](https://arxiv.org/abs/2310.04406), [CoALA](https://arxiv.org/abs/2309.02427).
- Start with a simple composition before a framework -> keep one small loop and native SDKs -> [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).

## Tools

- Tool interfaces affect success -> descriptions include examples, exclusions, input schema and result shape -> [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents), [SWE-agent](https://arxiv.org/abs/2405.15793).
- Choosing the API and forming arguments are separate failure points -> validate every native call and return a recoverable error -> [Toolformer](https://arxiv.org/abs/2302.04761), [Gorilla](https://arxiv.org/abs/2305.15334).
- Code expands the action space and risk -> start with three read-only functions; defer execution to a hosted sandbox milestone -> [CodeAct](https://arxiv.org/abs/2402.01030), [Tool-use survey](https://arxiv.org/abs/2603.22862), [Programmatic versus JSON tool calling](https://arxiv.org/abs/2608.06370).
- Protocols solve interoperability rather than this product's first loop -> no MCP/A2A layer yet -> [Agent protocols survey](https://arxiv.org/abs/2505.02279).

## Context

- Useful context is smaller than all available data -> bounded tool excerpts, with full evidence in separate storage -> [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [Context survey](https://arxiv.org/abs/2507.13334).
- Reusable context must remain inspectable -> design versioned summaries for M4, preserving goals and open decisions verbatim -> [ACE](https://arxiv.org/abs/2510.04618).
- The surrounding execution system matters -> measure loop bounds, transport completion and persistence, not just prompt wording -> [Terminal coding agents](https://arxiv.org/abs/2603.05344), [Harness engineering](https://arxiv.org/abs/2609.00006), [Harness design study](https://arxiv.org/abs/2609.20804).

## Memory

- Retrieval should bring relevant evidence into a bounded context -> plan owner-filtered, just-in-time recall rather than full history replay -> [RAG](https://arxiv.org/abs/2005.11401), [Self-RAG](https://arxiv.org/abs/2310.11511), [Agentic RAG](https://arxiv.org/abs/2501.09136).
- Storage and active context have different roles -> keep immutable chat evidence separate from future editable memory -> [Generative Agents](https://arxiv.org/abs/2304.03442), [MemGPT](https://arxiv.org/abs/2310.08560).
- Long-term memory introduces update and deletion problems -> explicit save/recall, visible Settings management, no sensitive fields, M4 only -> [A-MEM](https://arxiv.org/abs/2502.12110), [Mem0](https://arxiv.org/abs/2504.19413), [Memory survey](https://arxiv.org/abs/2603.07670).

## Safety

Milestone 5 reading: all 13 requested arXiv abstract pages were opened on 10 November 2026 with internet access. This focused pass examined the stated threat model, defense and evaluation design in the abstracts. It did not read all full papers or reproduce their experiments. The updated Firewalls title explicitly questions benchmark strength. The following are engineering decisions, not borrowed performance guarantees.

1. Instructions hidden in tool results can redirect actions, and safe failure alone does not prove utility -> wrap every observation, including memory recall and denial, in an escaped data-only block; test malicious pages alongside successful benign calculations -> [AgentDojo](https://arxiv.org/abs/2406.13352), [InjecAgent](https://arxiv.org/abs/2403.02691), [Agent Security Bench](https://arxiv.org/abs/2410.02644).
2. Model text cannot authorize a capability -> enforce a server-side write gate, exact saved call arguments, authenticated ownership, expiry and single-use approval; no model-generated approval field is accepted -> [CaMeL](https://arxiv.org/abs/2503.18813), [adaptive evaluation of out-of-band defenses](https://arxiv.org/abs/2606.26479).
3. Asking for confirmation on every harmless call reduces utility -> calculator, public fetch, search and memory recall remain automatic; all writes require a one-call card, and Deny becomes a normal observation -> [RTBAS](https://arxiv.org/abs/2502.08966). This is a deterministic side-effect rule, not RTBAS dependency screening.
4. Staged attacks can spread influence across steps -> taint the run before web access and persist it through confirmation and resume; never clear it after a harmless call; test instructions split over multiple pages -> [Blocking at the Boundary](https://arxiv.org/abs/2610.05163). We do not implement its model-based PAA auditor.
5. Memory is a durable trust boundary -> retain opt-in closed-set preferences only, show the proposed value before saving, wrap recall as data, and provide owner-bound Undo that cannot overwrite a newer edit -> [Trustworthy Memory Search](https://arxiv.org/abs/2606.06054). Neural memory gating is unnecessary for this small closed vocabulary and is not implemented.
6. Text defenses alone have limits, and boundary filtering must not be described as immunity -> remove HTML non-content elements, validate arguments, pin public DNS after every redirect, cap time/bytes, redact all audit argument values, and acknowledge remaining answer manipulation and outbound-query risks -> [prompt injection landscape](https://arxiv.org/abs/2602.10453), [Indirect Prompt Injections: Are Firewalls All You Need, or Stronger Benchmarks?](https://arxiv.org/abs/2510.05244). No learned sanitizer or firewall is claimed.
7. Ignoring an attack differs from refusing it -> fixture reports distinguish model obeyed/ignored/refused from system enforcement; a model attempting a write is labelled obeyed even when the write gate refuses execution. Record task completion and estimated cost too -> [Ignored, Not Refused](https://arxiv.org/abs/2610.23254), [AI Agents That Matter](https://arxiv.org/abs/2407.01502).
8. Predictable failures and bounded severity matter alongside success -> durable per-user limits, conservative global spend reservations before paid work, cumulative resume budgets, kill checks at each boundary, audit lifecycle events, and tests for replay/concurrency/expiry -> [Towards a Science of AI Agent Reliability](https://arxiv.org/abs/2602.16666).

Skipped for this milestone: full CaMeL information-flow tracking, RTBAS dependency screeners, PAA auditing, MemGate, model training, and large adaptive benchmark reproduction. Their scope and evaluation cost exceed this single-agent preference-only release. Local fixtures validate enforcement even when the mocked model attempts the attack; they do not measure a real model's attack success rate. No immunity or production benchmark claim is made.

## Evaluation

- Accuracy without cost is an incomplete comparison -> record usage and cost per run and compare simple baselines in M6 -> [AI Agents That Matter](https://arxiv.org/abs/2407.01502).
- One success is not reliable behavior -> repeated trials and pass^k, plus clear interruption and ambiguity outcomes -> [tau-bench](https://arxiv.org/abs/2406.12045), [Agent reliability](https://arxiv.org/abs/2602.16666).
- Benchmarks need controlled conditions -> fixture tools, held-out prompts, versioned criteria, report all failures -> [Rigorous agentic benchmarks](https://arxiv.org/abs/2507.02825).
- Optimization needs a trustworthy score first -> no prompt search or training before M6 evidence -> [DSPy](https://arxiv.org/abs/2310.03714), [GEPA](https://arxiv.org/abs/2507.19457), [Agentic RL survey](https://arxiv.org/abs/2509.02547).

## Multi-agent

- Coordination adds new failure modes -> one agent and one budget now -> [MAST](https://arxiv.org/abs/2503.13657).
- Specialist orchestration needs explicit responsibilities -> reserve workers for independent public research only after evaluation -> [Magentic-One](https://arxiv.org/abs/2411.04468), [AutoGen](https://arxiv.org/abs/2308.08155), [MetaGPT](https://arxiv.org/abs/2308.00352).
- Longer tasks compound uncertainty -> bounded horizons and honest stop reasons before more autonomy -> [Autonomous agent survey](https://arxiv.org/abs/2308.11432), [Agentic reasoning survey](https://arxiv.org/abs/2601.12538), [Horizon gap](https://arxiv.org/abs/2608.06663).

## Source coverage and limits

All 42 supplied arXiv IDs are linked above. Abstract-level review is sufficient for background choices here, but is not a substitute for reading methods before implementing later memory, training or multi-agent techniques. No experiments from these papers were reproduced. The implemented unit and integration tests check software behavior, not the research papers' capability claims.

Native API contracts were checked against [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling) and [Anthropic tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview). New dependencies are Cheerio for HTML text extraction and ipaddr.js for IPv4/IPv6 range classification. Neither is an agent framework.
