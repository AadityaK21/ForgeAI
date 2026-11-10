# Merova AI repository instructions

- Work in this repository only. Do not change merova.app, its repository or database.
- Brand: Merova AI. Use plain English. No em dashes in UI, docs, comments or commit messages.
- Preserve ordinary chat. Agent mode is per conversation and off by default.
- Read the current code before editing. Do not introduce an agent framework.
- Agent credentials come from server environment variables only. Never print or commit secrets, `.env` files, `.qa` artifacts or database files.
- `src/lib/agent` holds the agent prompt, provider adapters, loop, tools and public-network rules. `src/components/agent-steps.tsx` displays saved activity.
- `src/app/api/chat/route.ts` owns chat auth, rate limits, leases and streaming. All tool-output reads require conversation ownership.
- Prisma schema is in `prisma/schema.prisma`. Add an additive migration in a new directory. Do not change applied migrations or reset a database.
- Keep tool definitions, validation, timeouts and output caps together. No shell or generated code in the Vercel function. No side-effect tools without a future explicit confirmation design.
- Milestone 4 is authorized by the user follow-up. Memory is limited to approved preferences only. Milestone 5 is authorized for local implementation and verification. Milestones 6 and 7 are not authorized. Their designs are in `docs/AGENT_DESIGN.md`.
- Commands: `npm run setup`, `npm run dev`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:browser`.
- Browser tests use a separate temporary database. Do not run dev and build against the same `.next` directory at once.
- Test both ordinary chat and agent mode. Use deterministic SDK fixtures for tests; paid live API checks need configured credentials and must be reported separately.
- Main auto-deploys on Vercel. Do not push changes as part of a local implementation report unless publishing is requested.
