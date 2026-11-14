# Faster loading and Plain mode

## Review fixes and storage lifecycle

Saved sessions now record the reviewer revision and compact content identities for each question. Reordering or renumbering questions preserves answers for unchanged content; changes to wording, choices, exhibits or answer evidence discard the affected progress. Sessions from the older format cannot be mapped safely and reset with an explanation. Mixed-review sessions use the same reconciliation. Undo restores partial credit together with answers and results, and a new attempt clears the undo history.

Submitted Exam answers lock in both layouts. Each question retains its deadline when revisited or when switching layouts, and grading checks the deadline before accepting an answer. Simple-mode typing and focus changes batch session persistence into a 200 ms debounce; checking an answer, changing layouts, hiding the page and leaving flush immediately. Checked-question progress updates incrementally, and Simple mode does not copy undo snapshots on every grade.

New reviewer saves extract raster exhibits into immutable private blobs under `revvy/media/<version>/<content-hash>`. Each version has a unique namespace, so concurrent saves never adopt another version's files. Requests using `asset` read only that image blob and can use the browser cache. Existing inline reviewers and the original version-pinned `media` URLs remain supported. Existing content moves to separate image storage on its next save; reads do not migrate data. Raw downloads, exports, backups and older clients still receive inline image data.

After a successful conditional index write, storage cleanup deletes unreferenced reviewer and image blobs older than 24 hours. The index records live image version prefixes, keeping the catalog small even for reviewers with many exhibits. Each save scans up to 1,000 blobs and persists a continuation cursor, so subsequent saves cover larger stores. Active blobs, the original legacy library and recent uploads are protected. Failed writes leave recent uploads for a later sweep. Cleanup failures do not report committed saves as failed; cleanup retries on subsequent scan cycles. This is save-triggered maintenance, not a background schedule.

Deletion records are retained only where needed to hide a reviewer in the legacy library. Historical indexes beyond the former 1,000-entry cap can be read and compacted on the next save. The 300-active-reviewer limit is checked before uploads.

Mobile normal mode groups secondary actions into an accessible Tools menu and reduces spacing around the quiz. Exhibits open in a native modal with zoom, scrolling, keyboard dismissal and focus restoration in either layout. Quiz shortcuts are suspended while a modal is open. Mobile navigation focuses the visible reviewer search field, and the default motion setting follows the device preference.

Dependency updates include Vercel Blob 2.9, patched Undici and Vite versions, and a scoped Zod 4 override because `@vercel/cli-config` pins an affected Zod version. Keep the override until the parent dependency adopts a patched version. `npm audit` and `npm audit --omit=dev` report no known vulnerabilities for the updated lockfile.

Regression coverage exercises reordered and replaced questions, partial-credit undo, submitted exam locks, batched typing saves, deletion churn, direct image reads, portable exports, active-file protection, failed cleanup and paginated cleanup. Browser coverage also checks exhibit zoom, modal shortcut isolation, focus return and mobile menu bounds.

## Simple mode

Plain mode (Simple mode) is a device preference next to the theme controls. It shares the existing quiz state and grading rules. Light theme uses white; dark theme uses black. All questions appear in a single scrollable document, with no Back/Next pagination. Each question keeps its own answer, exhibits, feedback and explanation. Selecting Plain mode or returning to the normal layout preserves answers, progress and the current question.

Plain mode disables the normal stylesheet while active, including when entering from an already-loaded normal session. This prevents the normal flex layout and tinted surfaces from leaking into the plain layout. Its chrome uses only `#000` and `#fff`. After checking, the entire correct choice fills green (`#15803d`) and a selected wrong choice fills red (`#b91c1c`), with white text and explicit Correct/Incorrect labels. Original source exhibits keep their image colors. Desktop screens at 1024 px and above use a centered workspace up to 1280 px wide with two answer columns per question. Phones and tablets use a single-column flow with compact controls.

Single-choice answers check immediately. Multi-select, grouped statements, matching and written answers use a local Check answer button. Answering updates only that question's controls and feedback; other questions and the scroll position remain intact. Finish quiz checks any pending typed or multi-part answers, records unanswered questions and displays the existing score summary. Practice provides feedback without a scored summary. In scrollable Exam sessions, a question's existing deadline is preserved when switching layouts; other timers begin when interacting with their questions. Expired questions stay in place for later review. A new retry starts fresh deadlines.

The normal design remains available. Plain mode omits decorative UI, the full question navigator and secondary study tools. PDF and OCR imports, backup, print and reviewer management remain available through the normal layout.

## Loading and storage

- The entry module starts the quiz independently of PDF.js, its worker and the bundled starter reviewer. Those modules load only when needed. There is no minimum splash-screen duration.
- `base.css` supplies the plain layout. Normal decoration loads through a separate stylesheet, including when leaving a saved plain-mode visit.
- `/api/library` lists metadata: `id`, `title`, `questionCount`, `updatedAt` and `reviewerRevision`. Question data loads on selection or session restoration. Mixed review and backup use a maximum of three concurrent reviewer loads.
- IndexedDB stores public reviewer content by ID and revision. It does not store account credentials or study answers. Cache failures fall back to downloading. In-flight identical requests are shared; obsolete selections cannot replace the current screen.
- The catalog retains unloaded reviewers as explicit placeholders. Hydration updates the saved baseline. A placeholder is never uploaded as an empty reviewer or interpreted as a deletion. Clearing device data clears the cache and study progress while retaining shared catalog metadata.
- Version-pinned reviewer requests replace embedded raster figures with API media references. Figures load lazily near the visible questions and can use the browser HTTP cache. Off-screen question sections use CSS content visibility to reduce rendering work on long reviewers. GET does not rewrite or migrate stored reviewers. Existing inline-image clients remain supported. Portable export and backup explicitly request original inline image bytes.
- Multipart downloads pin the same reviewer revision for every part. A concurrent change rejects the old version rather than mixing content. The existing strong Blob revision handling and conditional index writes remain intact.
- Normal mode reuses question-navigator DOM nodes and updates affected cards. Plain mode does not build a navigator. Both layouts share question-input markup and grading. Matching placements and explanation toggles preserve the existing input controls. Finishing a scrolling session batches history persistence into one device-storage write.

Legacy index entries without summaries require server-side reviewer reads to derive metadata. Those reads are limited to three concurrent operations; new saves include summaries in the index. The local fixture benchmark does not model Vercel cold starts or Blob read latency.

## Measured comparison

Measured locally on 2026-11-14 against the pre-change build at `178edff`, using Chromium with a 390 x 844 viewport, 80 ms latency, 200,000 bytes/second download throughput and 4x CPU slowdown. Each fixture library contains four reviewers. The small reviewer has 12 text questions; the image-heavy reviewer has 170 questions with its first exhibit visible. These are individual controlled runs, not production field metrics or guaranteed load times.

| Cold visit | Previous normal | Updated normal | Plain |
| --- | ---: | ---: | ---: |
| Small: reviewer list usable | 5.68 s | 1.46 s | 0.88 s |
| Small: first question answerable | 7.37 s | 3.19 s | 1.31 s |
| Small: compressed response bodies | 690 KB | 78 KB | 55 KB |
| Image-heavy: reviewer list usable | 15.55 s | 1.45 s | 0.88 s |
| Image-heavy: first question answerable | 17.26 s | 3.34 s | 1.46 s |
| Image-heavy: compressed response bodies | 2,556 KB | 102 KB | 79 KB |

Plain repeat visits reached an answerable question in 0.60 s for the small fixture and 0.69 s for the image-heavy fixture, reusing downloaded reviewers and figures. The diagnostic click-to-two-animation-frames measurement was 7-19 ms for Plain mode and 14-35 ms for updated normal mode. This diagnostic is not an INP measurement. Navigation timings include automated menu selection and actionability waits. Compressed-body totals exclude HTTP header overhead; the JSON reports also record browser resource transfer sizes.

## Validation

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm run test:plain
```

`npm run test:browser` builds production assets and serves a local fixture API. It never writes to production storage. `REV_BROWSER_EXECUTABLE` can select an already installed Chromium executable. Reports and mobile screenshots are written under the ignored `output/performance/` directory. To compare an archived build, run `node tests/browser.cjs --before=path/to/old/dist`.

The browser checks verify deferred downloads, selected-reviewer loading, repeat-visit cache reuse, absent plain-mode decoration, layout switching, session restoration, image retries, complete portable backups, actual PDF-worker import, IndexedDB deletion, blocked-storage fallback and the `file://` distribution. Unit and integration checks cover question types, written answers, exam deadlines, late selections, mutation rebasing and persistent deletions. Three old test assertions were updated to inspect accessible labels on the existing icon controls, matching the pre-existing UI.

The responsive checks cover 320 x 640, 390 x 844, 768 x 1024, 1280 x 900 and 1920 x 1080 in both layouts and themes. They check horizontal overflow, answer/exhibit bounds, touch-target heights, reviewer-drawer alignment and answer interactions, and capture screenshots. Run only this matrix with `npm run test:responsive`. The Plain-mode drawer follows the measured header height as the viewport changes; Back/Next controls retain a minimum 44 px height on desktop and mobile.

`npm run test:plain` specifically checks normal-to-plain switching at 390, 1280 and 1920 px in both themes, then reloads, resizes across the desktop breakpoint and switches layouts again. It verifies computed chrome colors, full green/red answer backgrounds, stylesheet isolation, desktop/mobile column counts, a centered desktop workspace, keyboard shortcuts and retained answers. A 609-question check answers questions at both ends, reloads the session and verifies the final score without pagination or replacing unrelated controls. This regression is also included in the full browser suite.

The remaining large build warning concerns the deliberately deferred starter-reviewer chunk. Deploy client assets and the API together for the new loading path. No destructive data migration is required; older clients still receive the original inline reviewer format.
