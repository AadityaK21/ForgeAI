# ForgeAI design review

Updated 4 November 2026.

## Scope and recovery

The target is the ForgeAI agent at localhost:3000 in this repository. The owner's correction supersedes the studio-site path in the supplied design brief.

The local source was recorded at 6980964 before this pass. The agent already had real account, provider, sandbox, project, revision, editor, inspection and export code. Those capabilities were retained.

Audit findings:
- Old green and warm accents conflicted with the requested monochrome palette.
- The workspace had a second narrow navigation rail and oversized decorative content.
- Mobile account screens put the illustration before the form.
- Inspector surfaces and Monaco did not consistently follow the document theme.
- The guided example stylesheet had not been tracked.
- A storage error could interrupt navigation or sign-out.
- The settings button's accessible name differed from its visible label.
- Settings, validation and data tools loaded before visitors needed them.

## Phase record

These edits resumed a partially completed local design pass. Saved changes were verified together before being organized into phase commits. The record does not imply independent full browser runs at every historical commit.

| Phase | State | Changes and evidence |
| --- | --- | --- |
| 0 Audit | Complete | Recorded existing source, inspected the actual builder, restored the example stylesheet. 22 automated tests passed; two optional Docker tests skipped. |
| 1 Palette | Prepared | Neutral tokens, theme persistence and inspector surfaces. |
| 2 Typography | Prepared | Self-hosted Absans and JetBrains Mono; account layout and type hierarchy. |
| 3 Motion | Prepared | Native masked headline reveal and token-driven movement. |
| 4 Mark and workspace | Prepared | Original mark, exploded application drawing, responsive composer and navigation. |
| 5 Guided build | Prepared | Deterministic demonstration, original pixel bird, accessible controls and lifecycle cleanup. |
| 6 Final QA | In progress | Production build, browser matrix, account workflows and performance measurements. |

## Verification so far

- TypeScript compilation passes.
- Production compilation passes.
- 48 route/layout checks at 375, 768, 1280 and 1920 pixels, with both themes and reduced/full motion, passed before the final accessible-label fix.
- Sign-up, sign-out, sign-in, project persistence and file inspection exercised against a disposable SQLite database.
- Demo loop, offscreen pause, simulated hidden-tab signal, manual pause, focus restoration, session-only intro and denied storage behavior pass.
- Final production accessibility and Lighthouse reruns are pending.

## Open limits

The requested total-JavaScript budget is 60 KB gzip. Next.js and React alone account for about 103 KB of the build's first-load estimate. This budget is not met by the existing framework. Heavy interactive tools are loaded when opened.

Live Anthropic/E2B generation, Docker execution and a physical Android device are not covered by this design pass. Existing compiler/runtime tests use local fixtures and the real compiler. No paid provider requests have been claimed.

Studio Supabase, payments, DNS, hosting and legal pages are outside this repository's design scope.
