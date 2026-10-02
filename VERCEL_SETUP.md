# Vercel setup

The app serves the reviewer library publicly and restricts reviewer changes to the single owner login. Study progress remains local to each visitor's browser.

## 1. Connect storage

In the Vercel project, create a **private Vercel Blob store** and connect it to this project. The app stores the shared reviewer JSON in that store. The Blob SDK uses Vercel's project identity when deployed; do not expose a Blob token to the browser.

## 2. Set production environment variables

In **Project Settings → Environment Variables**, add:

- `OWNER_USERNAME`: `cval`
- `OWNER_PASSWORD`: the password selected for the owner account
- `OWNER_SESSION_SECRET`: a new random value of at least 32 characters. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

Keep the password and session secret server-only. Do not add `VITE_` to either variable and do not commit real values to Git.

## 3. Deploy and initialize

Deploy the project after connecting storage and setting the variables. Sign in using the owner account once; if the shared library is empty, the app copies the available local reviewers into Vercel Blob. The current bundled reviewer is included automatically. Use the owner's **Restore** control to bring in any additional local backup. Future reviewer imports, edits, restores, and deletions are saved to the shared library. Other visitors see those changes when they refresh.

The API rejects reviewer writes without a valid owner session, even if a visitor manually reveals a hidden control. A private Blob store is required; without it, owner sign-in and local study still work, but shared reviewer updates cannot be saved.

For local development with the Vercel APIs and private Blob storage, use the Vercel CLI rather than Vite's static dev server.
