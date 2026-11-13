# Faster loading and Plain mode

Plain mode is a device preference next to the theme controls. It shares the existing quiz state and grading rules. Light theme uses white; dark theme uses black. The plain layout keeps the question, required exhibits, answer inputs, feedback, explanation, navigation and an exam countdown where applicable. Selecting Plain mode or returning to the normal layout preserves answers, progress and the timer deadline.

The normal design remains available. Plain mode omits decorative UI, the full question navigator and secondary study tools. PDF and OCR imports, backup, print and reviewer management remain available through the normal layout.

## Loading and storage

- The entry module starts the quiz independently of PDF.js, its worker and the bundled starter reviewer. Those modules load only when needed. There is no minimum splash-screen duration.
- `base.css` supplies the plain layout. Normal decoration loads through a separate stylesheet, including when leaving a saved plain-mode visit.
- `/api/library` lists metadata: `id`, `title`, `questionCount`, `updatedAt` and `reviewerRevision`. Question data loads on selection or session restoration. Mixed review and backup use a maximum of three concurrent reviewer loads.
- IndexedDB stores public reviewer content by ID and revision. It does not store account credentials or study answers. Cache failures fall back to downloading. In-flight identical requests are shared; obsolete selections cannot replace the current screen.
- The catalog retains unloaded reviewers as explicit placeholders. Hydration updates the saved baseline. A placeholder is never uploaded as an empty reviewer or interpreted as a deletion. Clearing device data clears the cache and study progress while retaining shared catalog metadata.
- Version-pinned reviewer requests replace embedded raster figures with API media references. Figures load for the displayed question and can use the browser HTTP cache. GET does not rewrite or migrate stored reviewers. Existing inline-image clients remain supported. Portable export and backup explicitly request original inline image bytes.
- Multipart downloads pin the same reviewer revision for every part. A concurrent change rejects the old version rather than mixing content. The existing strong Blob revision handling and conditional index writes remain intact.
- Normal mode reuses question-navigator DOM nodes and updates affected cards. Plain mode does not build a navigator. Matching placements and explanation toggles preserve the existing input controls.

Legacy index entries without summaries require server-side reviewer reads to derive metadata. Those reads are limited to three concurrent operations; new saves include summaries in the index. The local fixture benchmark does not model Vercel cold starts or Blob read latency.

## Measured comparison

Measured locally on 2026-11-14 against the pre-change build at `178edff`, using Chromium with a 390 x 844 viewport, 80 ms latency, 200,000 bytes/second download throughput and 4x CPU slowdown. Each fixture library contains four reviewers. The small reviewer has 12 text questions; the image-heavy reviewer has 170 questions with its first exhibit visible. These are individual controlled runs, not production field metrics or guaranteed load times.

| Cold visit | Previous normal | Updated normal | Plain |
| --- | ---: | ---: | ---: |
| Small: reviewer list usable | 5.68 s | 1.47 s | 0.84 s |
| Small: first question answerable | 7.37 s | 3.24 s | 1.25 s |
| Small: compressed response bodies | 690 KB | 74 KB | 51 KB |
| Image-heavy: reviewer list usable | 15.55 s | 1.40 s | 0.87 s |
| Image-heavy: first question answerable | 17.26 s | 3.34 s | 1.37 s |
| Image-heavy: compressed response bodies | 2,556 KB | 98 KB | 76 KB |

Plain repeat visits reached an answerable question in 0.59 s for either fixture and reused downloaded reviewers and figures. The diagnostic click-to-two-animation-frames measurement was 3-9 ms for Plain mode and 16-29 ms for updated normal mode. This diagnostic is not an INP measurement. Navigation timings include automated menu selection and actionability waits. Compressed-body totals exclude HTTP header overhead; the JSON reports also record browser resource transfer sizes.

## Validation

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

`npm run test:browser` builds production assets and serves a local fixture API. It never writes to production storage. `REV_BROWSER_EXECUTABLE` can select an already installed Chromium executable. Reports and mobile screenshots are written under the ignored `output/performance/` directory. To compare an archived build, run `node tests/browser.cjs --before=path/to/old/dist`.

The browser checks verify deferred downloads, selected-reviewer loading, repeat-visit cache reuse, absent plain-mode decoration, layout switching, session restoration, image retries, complete portable backups, actual PDF-worker import, IndexedDB deletion, blocked-storage fallback and the `file://` distribution. Unit and integration checks cover question types, written answers, exam deadlines, late selections, mutation rebasing and persistent deletions. Three old test assertions were updated to inspect accessible labels on the existing icon controls, matching the pre-existing UI.

The responsive checks cover 320 x 640, 390 x 844, 768 x 1024, 1280 x 900 and 1920 x 1080 in both layouts and themes. They check horizontal overflow, answer/exhibit bounds, touch-target heights, reviewer-drawer alignment and answer interactions, and capture screenshots. Run only this matrix with `npm run test:responsive`. The Plain-mode drawer follows the measured header height as the viewport changes; Back/Next controls retain a minimum 44 px height on desktop and mobile.

The remaining large build warning concerns the deliberately deferred starter-reviewer chunk. Deploy client assets and the API together for the new loading path. No destructive data migration is required; older clients still receive the original inline reviewer format.
