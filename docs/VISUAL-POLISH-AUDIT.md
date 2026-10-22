# Visual polish audit

Scope: presentation layer only (web/style.css, one stray literal in web/app.js). No behavior, ids, handlers, text, server, tests or voice/PPTX code were changed.

## Inventory and findings

| Screen / component | Files | Finding | Action |
|---|---|---|---|
| Presenter shell (bar, stage, controls) | web/app.js `renderPresenter`, style.css Backstage layer | Already calm; mobile grid reads well | Left alone |
| Presenter on phone (<=820px) | style.css:594-601, 681 | Body dark gradient covered only 100% height; on the tall stacked page the light root canvas showed below the fold, making side-rail text near-invisible (light on light) | Fixed: root and body paint the console color |
| Side rail drawers (import, library, pulse, field, cognitive, readiness, voting) | web/*-ui.js | Every drawer shows full-weight secondary buttons, competing with the single primary key | Secondary actions now quiet chips (smaller, outlined, muted) |
| Director box | app.js ~378-423 | Stray literal text ` : ""}` rendered after the memory drawer (template typo); label had no visual anchor | Removed stray text; added small jade dot to label; buttons start-aligned |
| Import / readiness explanatory paragraphs | import-ui.js, app.js | Long help text. Text is asserted/used by tests and flows | Text kept; muted and normalized size only |
| Cognitive tool sections | living-intelligence-ui.js | Divider after last section | Last divider removed |
| Audience screen, vote projection | style.css | Minimal; projector content, scene engine guarded by infographic tests | Left alone |
| Student vote page, vote-admin, review | vote*.html/js, review.html | Already themed in the Backstage layer | Left alone |
| Infographic scenes / cognitive card stage | infographic.js, scene-*.js | Guarded by layout/infographic tests | Left alone |
| Loading / error states | index.html, style.css | Plain text, brief | Left alone |

Not rendered here: audience window with real PPTX decks, live voting session, real microphone (voice nav) flows.

## Round 2 — elevation and quiet motion

Scope: presentation only. `web/style.css` gained a "Round 2" layer at the end of the file (student pages may only load `/style.css` per the server allow-list, so a separate CSS file was not possible; the layer is last, so it wins). One additive, `aria-hidden` block was added in `web/app.js` (`renderReadiness`). No ids, handlers, text, server, voice, PPTX, import or test files changed.

### Screens and what changed

| Screen | Change | Left alone and why |
|---|---|---|
| Presenter side rail (import, library, pulse/review, field trial, cognitive tools, readiness, voting, director) | Each drawer header is now an icon tile + the existing short label + chevron; director label gets a mic tile; slightly more generous padding and gap | All drawer bodies, buttons and texts (tests click them by id/text) |
| Readiness drawer | Four tiles (slides, videos, native-animation slides, step-by-step slides) built from the same real `summarizeLecture` counts as the sentence below; a thin bar shows step-by-step / animated only when there are animated slides | The sentence and verdict stay as the accessible text; tiles are `aria-hidden` |
| Student vote page | Removed the 100vh gaps between question, pulse and ask sections; numbered option badges (CSS counter, structural only), check mark on the chosen option, results rows as soft cards, centred empty/waiting state with icon, ask-lecturer as a card with icon and chevron | `vote.js` markup, ids, selectors, texts |
| Review page | Numbered timeline (dot + rail), slide number as a pill, lines in a soft card, brass rule under the title, centred empty state | `review.js`/`review.html` markup and texts |
| Vote console (standalone and in the presenter iframe) | Styled selects, number input, checkboxes (accent), QR on a white tile, drawers as quiet rows with chevron | Structure, ids |
| Loading / error | Centred, quiet | Text |
| Audience view, slide stage, vote projection, scene/infographic engine, cognitive card stage | Nothing | Projected content; guarded by infographic/layout tests; no new motion |

### Motion inventory (all inside `prefers-reduced-motion: no-preference`; none without it)

Tokens: `--ease-out: cubic-bezier(.2,.7,.2,1)`, `--dur-1/2/3: 120/180/260ms`, `--step: 40ms`. Only `transform` and `opacity` animate. `animation-fill-mode: backwards`, so the end state is the plain static design (verified: computed opacity 1, transform none).

- Side rail children: one fade+rise (8px) per element on load, stagger 40ms, max 8.
- Drawer bodies: 180ms fade when opened (not for nested details).
- Readiness tiles: staggered rise; step-by-step bar grows once to the real ratio (scaleX).
- Press `scale(.98)` on console buttons and vote options; hover lift 1px on vote options (hover devices only); icon tile scale on drawer-header hover.
- Student vote: the container rises once. Re-rendered poll content is never re-animated (the page rebuilds it on every poll tick).
- Review: title and each section rise once, staggered.
- Loading/error: 180ms fade.
- Not done: focus-ring ease (outline is not transform/opacity), progress growth on vote bars (they re-render on every count change and would replay).

### Verification and gaps

See the final report for exact commands. Not rendered here: audience window with real PPTX decks and live voice navigation (no microphone), a lecture with animated slides in the readiness tiles (fixture has none, so the ratio bar was not seen), real phones.

Test note: `npm run test:e2e-stress` fails one check ("no console or page errors": `AbortError: play() interrupted by pause()` from the video element). It fails identically on the untouched baseline (verified with `git stash`), so it predates this round and is a JS media-handling matter, not CSS.
