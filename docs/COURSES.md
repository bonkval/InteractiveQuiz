# Course authoring

Revvy reads a catalog at `public/courses/catalog.json`. Each entry points to a course JSON file. Opening the library fetches only the catalog; a course loads when selected. Source PDFs load only when a learner opens a reference.

The renderer in `course-app.js` is independent of subject matter. It supports text, lists, tables, ordered flows, plain-text formulas, and images. Text supports `**bold**` emphasis; raw HTML is escaped. Physics and networking content can use the same structure with worked examples, equations, and diagrams.

## Add a prepared course

1. Create `public/courses/<course-id>/course.json`.
2. Add an entry to the catalog with `id`, `title`, `description`, `code`, `moduleCount`, `lessonCount`, and `content` (the URL).
3. Give modules and lessons stable IDs. Progress uses `course-id/lesson-id`; avoid changing IDs for copy edits. Use a new lesson ID when changing its meaning or assessment substantially.
4. Add authored explanations and checks; do not substitute extracted slide text for a lesson. Keep added examples distinguishable from source claims. Reference the source deck and slide range for each lesson.
5. Run the build and course browser checks. Confirm diagrams, formulas, and long tables at small widths.

Course fields: `id`, `title`, `description`, `editorialNote`, `sources`, `modules`.

Each source has `id`, `title`, `url`, and optionally `originalName`. Local source and image URLs start with `/courses/`; external references use HTTPS.

Each module has `id`, `title`, `description`, `lessons`.

Each lesson has `id`, `title`, `goal`, `minutes`, `essentials` (strings), `blocks`, `example` (`situation`, `explanation`), `recall` (`prompt`, `answer`), `check` (`prompt`, `options`, zero-based `correct`, `explanation`), and `sources` (`id`, `pages: [start, end]`). Optional `correction` and `references` (`title`, `url`) separate editorial updates from original slides.

Blocks:

- `text`: `title`, `text`
- `list`: `title`, `items`
- `table`: `title`, `headers`, `rows`
- `flow`: `title`, `steps`
- `formula`: `title`, `text` (Unicode or plain-text equation, no HTML)
- `image`: `src`, `alt`, `caption`

## First course

`scripts/prepare-course.py` contains the authored IT0204 lessons and copies the 13 source PDFs from the supplied export ZIP into stable reference paths. Run `python scripts/prepare-course.py <export.zip>` to regenerate. It preserves other catalog entries. The course has 8 modules and 34 lessons, consolidating overlapping subtopic decks. It is a guided companion covering central concepts, not a complete transcription of all 575 source pages.

Selected legal and standards clarifications have official references and a visible check date. These are not a certification that every slide claim or historical case detail has been verified. Avoid teaching an outdated slide statement as current law.

## Study data

`rev-courses-v1` in localStorage holds device-local notes, completion, flags, answers, module practice results, course folders, and resume positions. Reading completion and check correctness are distinct. Course progress can be backed up and restored from the library without owner access; it is also included in reviewer backups. Data & deletion clears course data too. Prepared course content remains part of the app.

New course folders created in the app are device-local placeholders until prepared content is added to the catalog. There is no PDF-to-lesson service or automatic conversion in the app. Reviewers retain their existing shared library and owner authorization model.

## Verification

`npm test` runs existing reviewer checks. `npm run test:courses` builds and exercises real browser course navigation, all lessons, persistence, quiz scoring, retry, filters, course folders, and desktop/mobile/dark/simple layouts. Set `REV_BROWSER_EXECUTABLE` when using a system Chrome instead of Playwright's bundled browser.
