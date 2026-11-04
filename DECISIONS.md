# ForgeAI design decisions

4 November 2026.

## Target

The owner explicitly corrected the target to the ForgeAI agent. The implementation stays in this Next.js repository and keeps the existing account and build backend. The supplied studio brief's SHOW_WORK flag, payments, legal pages, DNS and hosting configuration do not apply to this agent's UI.

The GitHub repository supplied by the owner was empty. A baseline branch preserves the existing local source so a review pull request can show the redesign without publishing an application.

## Visual direction

A monochrome drafting workspace puts the prompt and source work first. An original exploded SVG represents interface, API and data layers. It uses no external image, canvas, video or animation package. The original Fold mark is reused for the agent's thinking state.

[Eloqwnt](https://www.eloqwnt.com/) informed editorial labels and restrained hierarchy. The [AI Energy Technology reference](https://dribbble.com/shots/27806238-AI-Energy-Technology-Website) informed the presentation of technical layers. The [Okara animation reference](https://dribbble.com/shots/27287390-Okara-Ai-logo-animation) describes a short build-up into a settled mark. Reference pages and descriptions were available; the exact motion timing was not measured from their video. This implementation uses original artwork and timings from the owner's brief.

## Fonts and theme

[Clt Absans](https://www.collletttivo.it/typefaces/absans) and JetBrains Mono are the only bundled families. Both font files and their SIL Open Font Licenses are in public/fonts. A single Absans style uses size and tracking for hierarchy; no synthetic bold or italic is used for it.

The prepaint script selects a saved theme or system preference. Storage errors do not prevent navigation. An in-memory choice survives components mounting when storage is unavailable. Cross-tab preference changes remain supported.

Monaco resolves the same CSS palette as the surrounding workspace. Syntax remains monochrome, with comments, selections and diagnostics distinguished by neutral contrast and style.

## Motion

Motion uses CSS transforms and opacity with 150, 300 and 600 ms tokens. Theme colors cross-fade for 250 ms as specifically requested. Reduced motion disables movement. No animation dependency, scroll hijacking, pinned scene or continuously running background canvas was added.

The persistent application toolbar stays stable instead of changing its dimensions while editing. The small workbench is not given a marketing-site service marquee. Account forms come before their artwork on mobile.

## Guided example and real builds

Watch a build is explicitly labelled a scripted walkthrough. Its fictional Index Coffee interface has a working roast selector. It makes no model call, reports timeline timestamps rather than invented production performance, and does not impersonate a provider.

The presence mapping in src/components/build-demo.tsx selects the original mark or original drafting bird. The useDemoClock hook owns the timeline. A future live-demo adapter can supply the same phase/headline state from server events and must close that stream on unmount. Live credentials remain server-side.

Use this brief moves a complete prompt into the real builder composer. Run build continues to call the existing authenticated /api/sandbox pipeline. The demo is not substituted for actual generated source or a sandbox preview.

## Performance and verification

Monaco and the guided demo are lazy loaded. Provider settings, request validation and the data inspector are now loaded on demand too. This preserves the backend's validation while reducing initial client JavaScript.

The 60 KB total-JavaScript budget came from a static-site brief. Next.js/React shared runtime exceeds it on its own. Replacing the application framework would be a separate migration, so the measured limitation is reported openly.

The browser suite uses actual routes and a disposable local database for account tests. A hidden-tab signal is simulated because headless browsers do not reliably background tabs. The offscreen pause is tested by actual scrolling. Lighthouse uses mobile emulation, not a physical Android phone.

## Review scope

No production release is part of this review. Private account infrastructure is retained. Public signup verification, password recovery, subscription entitlements and usage metering are still required before a paid public launch, as described in README.md.
