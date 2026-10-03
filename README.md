# Rev interactive quiz

## Run locally

```powershell
npm ci
npm run dev
```

Open the URL printed by Vite. This runs the quiz and local import flow. The owner login and shared reviewer library use the Vercel API, so use `vercel dev` with project environment variables when testing those features locally. Deployment instructions are in [docs/VERCEL_SETUP.md](docs/VERCEL_SETUP.md).

For a browser-only offline copy, open `index.html` directly. The `offline/vendor` PDF.js files support PDF import in that mode. They are kept out of production builds, which use the npm PDF.js dependency instead.

## Project files

- `index.html`, `app.js`, `study-app.js`, `styles.css`, and `core.js`: app shell, UI, and parser.
- `reviewer-data.js` and `exhibit-alts.js`: bundled reviewer and exhibit descriptions.
- `api/`: owner login and shared Vercel Blob library.
- `public/`: mascot used by the deployed app.
- `offline/vendor/`: PDF reader for opening `index.html` directly.
- `privacy.html`, `terms.html`, `cookies.html`, and `legal.css`: published policy pages.
- `tests/`: automated checks; run with `npm test`.

`dist/` is a generated build and `node_modules/` contains installed dependencies. Both are ignored by Git. Keep exported reviewer files outside the app folder; `output/` is ignored if a local tool creates it again.
