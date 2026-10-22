# Quality scorecard (Round 3)

Presentation only. All CSS stays in `web/style.css` (the server allow-list serves only `/style.css`); no new served files. No logic, server, audio, media, voice, slides or test changes.

## Method

A Playwright + axe harness audited each reachable screen at 320 / 390 / 768 / 1280 px, in light, dark (colour scheme) and light with `prefers-reduced-motion: reduce`. Hard criteria: H1 axe violations, H6 visible keyboard focus on every focusable, H9 and others (overflow, contrast, console errors). Soft metrics (informational): paragraph text walls, tiny fonts, targets under 44px, infinite animations.

Screens: presenter, presenter with `?dev=1`, presenter with every drawer open, audience, student vote (poll, results, free words, waiting, bad code), review (content, empty, bad link), vote-console sign-in and vote-console. 168 screen x viewport x mode combinations.

## Before / after

| | Before | After |
|---|---|---|
| Combinations passing every hard criterion | 15 / 168 (9%) | 168 / 168 (100%) |
| H1 axe failures | 129 | 0 |
| H6 focus-visibility failures | 108 | 0 |
| H9 failures | 12 | 0 |
| axe rules hit | landmark-complementary-is-top-level, page-has-heading-one, scrollable-region-focusable, aria-prohibited-attr | none |
| Soft: text-wall paragraphs | 48 | 48 (all in the "every drawer open" test state, which concatenates drawer containers; not real paragraphs) |
| Soft: targets under 44px (mouse pointer) | 873 | 396 presenter + 72 console (compact desktop chips; touch devices get 44px via the `pointer: coarse` rule); 0 on student and review pages |
| Infinite animations | 0 | 0 |

## What changed

- Landmarks and headings: page-level visually hidden `h1` on presenter, student vote and review pages; the lecturer rail is a labelled, keyboard-focusable region (was a nested `aside`); hidden `h2`/`h3` so drawer sub-headings keep a valid order; QR block has an image role.
- Focus: rail focus ring drawn inside the box; closed drawers hide their content from the tab order explicitly.
- Student vote: the send button used canvas-on-canvas colours and now uses the accent fill; text fields have a visible edge and 48px minimum height; the understanding pulse is a distinct group; pulse buttons 60px tall.
- Console: checkboxes and file buttons follow the palette; the vote console leads with the session code, the join link is quiet and left-to-right, tighter heading scale.
- No new motion in this round.

## Left alone (judged by eye as already good)

Presenter stage and controls, drawer headers and readiness tiles, student option cards and results, review timeline, loading/error states, projected audience content and scene engine.

## Not viewed or not measured

- Audience window with real PPTX decks, live voice navigation (no microphone), real phones and real projectors.
- Screenshots were judged at 390 and 1280 for the main screens; most dark-mode screenshots and the 320 / 768 viewports were measured by the harness but not examined by eye.
- Slides with native animation in the readiness tiles (fixture has none).
- Arabic typography was checked on the screens above only; contrast was checked by axe and by eye, not with a projector.

## Known baseline failure (not ours)

`npm run test:e2e-stress`: `AbortError: play() interrupted by pause()`; identical on the untouched baseline; not fixed here.

## Test results

The repo defines no lint or build script. Every `test:*` script was run individually (Chromium via `CHROME_PATH`, fixtures from `tools/make_test_fixture.py` and `tools/make_test_pdf.py`). All passed except:

- `test:e2e-scenes`: timing-sensitive "fully visible after the motion" checks; a different subset fails on each run on this loaded machine, and the untouched `origin/main` also fails it (14 failures there). Not caused by this round, which adds no motion and touches no scene code; not fixed.
- `test:e2e-stress`: failed in the baseline per round 2 notes; passed on this run (flaky, timing dependent).
