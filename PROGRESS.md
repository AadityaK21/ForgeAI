# ForgeAI design review

Updated 4 November 2026.

## Scope and recovery

The target is the ForgeAI agent at localhost:3000 in this repository. The owner's correction supersedes the studio-site path in the supplied design brief.

The local source was recorded at 6980964 before this pass. The agent already had real account, provider, sandbox, project, revision, editor, inspection and export code. Those capabilities were retained.

Audit fixes:
- Replaced green and warm accents with neutral tokens throughout the builder UI.
- Removed the second narrow navigation rail and rebuilt the welcome page around the composer.
- Put account forms before their artwork on mobile.
- Matched inspector surfaces and Monaco to the document theme.
- Restored the untracked guided-example stylesheet.
- Allowed navigation and sign-out to finish when browser storage is unavailable.
- Matched the settings button's accessible name to its visible label.
- Deferred settings, validation, the data inspector and the guided example until needed.

## Phase record

These edits resumed a partially completed local design pass. Saved changes were verified together before being organized into phase commits. The record does not imply independent full browser runs at every historical commit.

| Phase | State | Changes and evidence |
| --- | --- | --- |
| 0 Audit | Complete | Recorded existing source, inspected the actual builder, restored example styles. |
| 1 Palette | Complete | Neutral tokens, theme persistence, prepaint selection and inspector surfaces. |
| 2 Typography | Complete | Self-hosted Absans and JetBrains Mono; account layout and type hierarchy. Both OFL notices retained. |
| 3 Motion | Complete | Native masked headline reveal and token-driven movement. Reduced-motion checks pass. |
| 4 Mark and workspace | Complete | Original mark, exploded application drawing, responsive composer and navigation. |
| 5 Guided build | Complete | Deterministic walkthrough, original pixel bird, roast selector, keyboard controls and lifecycle cleanup. |
| 6 Final QA | Verified with limits below | Production build, browser matrix, account workflows and performance measurements pass. |

## Executed verification

- TypeScript compilation and optimized Next.js production build pass.
- Automated backend/compiler suite: 22 passed, zero failed; two opt-in Docker integrations skipped.
- Browser suite: 48 route/layout checks across 375, 768, 1280 and 1920 pixels, light/dark themes and reduced/full motion.
- 13 WCAG A/AA audits pass across account pages, settings, the scripted example and the authenticated code inspector.
- No page errors recorded in those checked flows.
- No horizontal overflow in the 48 checked layouts.
- Actual sign-up, sign-out, sign-in and project persistence tested against a disposable SQLite database.
- Saved BRIEF.md loaded from the real API in Monaco and the plain-text inspector; editor theme switching and data/terminal navigation pass.
- Demo loop, offscreen pause by scrolling, simulated hidden-tab signal, manual pause, keyboard appearance tabs and focus restoration pass.
- Session-only mark intro, prepaint theme selection, reload persistence, reduced motion and denied browser storage behavior pass.
- Browser QA dependencies are pinned and npm run test:browser is available. README explains isolated account tests.
- All tracked text and pending source were scanned for U+2014: zero matches.
- Only .env.example is tracked. Source scan found no configured credential values.

## Mobile Lighthouse

Production Next.js server, Chrome mobile emulation. Baseline was measured before this design pass. The final measurement ran after the browser matrix finished.

| Measure | Before | Final |
| --- | --- | --- |
| Performance | 91 | 96 |
| Accessibility | 100 | 100 |
| Cumulative layout shift | 0.00144 | 0.00216 |
| Largest contentful paint | 2.71 s | 2.71 s |
| Total blocking time | 260 ms | 30 ms |
| JavaScript transfer | 152,651 bytes | 127,554 bytes |

The build's first-load JavaScript estimate fell from approximately 151 KB before the on-demand loading pass to 124 KB. Scores are local lab observations and can vary by machine and hosting.

## Checklist and limits

- [x] Monochrome builder UI and light/dark themes.
- [x] Self-hosted Absans and one mono family, with licenses.
- [x] Token-driven motion and reduced-motion behavior.
- [x] Session-only logo intro and thinking state.
- [x] Guided example loops, pauses offscreen and works on mobile.
- [x] Mobile Lighthouse performance at least 90, accessibility at least 95 and CLS below 0.05.
- [x] Browser checks pass.
- [x] Existing account API and sandbox behavior retained; local integration checks pass.
- [x] No U+2014 in tracked text.
- [ ] Total JavaScript below 60 KB gzip. The existing Next.js/React shared runtime alone is about 103 KB. This budget is not met.
- [ ] Physical mid-range Android scrolling profile. Desktop mobile emulation was used.

No user-facing content placeholders were introduced. Index Coffee is identified as a scripted fictional example.

Live Anthropic/OpenAI/E2B generation was not exercised in this design pass. No provider keys are configured in the local environment. Configure a model key in server settings or the documented environment variables to verify a paid build; E2B credentials are needed only for the cloud VM option. Docker was unavailable for its two optional tests.

Public email verification, account recovery, subscriptions and metering remain prerequisites for a paid public launch. This review does not claim those are complete.

Studio Supabase, payments, DNS, hosting and legal pages are outside this repository's design scope. No production deployment was performed.
