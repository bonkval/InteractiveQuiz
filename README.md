# Rev

Rev is a quiz reviewer that runs in the browser. Reviewer questions, progress, and editable prompts are saved on the current device. Export a backup to move reviewers to another device.

## Run locally

For immediate offline studying, open `index.html` directly. It loads the local reviewer without an account. Your existing browser data is kept. The account button is hidden in this file mode.

For the Vercel version or local account development, install Node.js, then run:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. `npm run build` creates the production site in `dist/`; `npm run preview` serves that build locally. Both the direct-file and Vite paths run the same `study-app.js` code.

## Accounts and deployment

Rev supports email and password accounts through Supabase Auth. Without Supabase settings, the reviewer still works locally and the account form explains what is missing. Accounts are separate from the guest library on the same browser. **Signing in does not sync reviewers between devices yet.** Use Backup and Restore to move them. No passwords are stored by Rev.

1. Create a Supabase project and enable email signups in Authentication. Copy the project URL and **publishable** key from the project settings. Never use a secret or service role key in the browser.
2. Copy `.env.example` to `.env.local` and replace its sample values with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Restart the local dev server.
3. In Supabase Auth URL Configuration, set the Site URL to your production Vercel URL and allow `http://localhost:5173` as a redirect URL for local email confirmation.
4. Import this GitHub repository into Vercel. The `vercel.json` file selects Vite. Add the same two `VITE_` variables in Vercel project Environment Variables, then deploy. They are public browser settings; do not put private keys there. To enable in-app account deletion, also add `SUPABASE_SECRET_KEY` as a **server-only** Vercel variable. Never prefix it with `VITE_`.

Each user gets an account-specific library in that browser. Cloud reviewer storage needs a future database table and Row Level Security before users can access the same reviewers on their phone and PC. Keep backups until that is added.

Rev has a [Privacy Policy](privacy.html), [Terms of Service](terms.html), and [Cookie Policy](cookies.html). It uses only the local storage needed for study and authentication, with no analytics or advertising cookies. The **Data & deletion** link in the app removes study data from the browser; on a configured Vercel deployment, it can also delete the signed-in account. There is no optional tracking to consent to, so Rev does not show a cookie banner.

The bundled S2 It0015 reviewer was rebuilt from the source PDF. It has 170 questions: 147 with four choices, 23 True/False, and 21 attached exhibit images. The app updates the earlier malformed bundled copy in local storage when it recognizes it. Importing the same PDF matches its questions to those bundled exhibits.

## Import format

Paste plain text, or choose a PDF, TXT, Markdown, or exported JSON file. The Import prompt in the sidebar gives an AI a format the app reads reliably:

```text
Question 1
What does STP prevent?
Choice A: prevents routing loops
Correct! Choice B: prevents Layer 2 loops
Choice C: creates smaller domains
Choice D: disables ports

Question 2
Name the protocol.
Answer: STP

Question 3
Refer to the exhibit. Which topology is shown?
Exhibit: topology.png
Alt text: Two switches connected by a trunk link.
Correct! Choice A: EtherChannel
Choice B: VLAN trunking
```

Mark every correct choice with `Correct!` for questions with multiple answers. Choice order is preserved. The app recognizes duplicate question text and keeps a copy with a marked answer when available. An `Exhibit:` line may name an image file, an `https://` image, or a `data:image/...;base64,...` image. Add `Alt text:` after an exhibit to describe the visible information for screen-reader users. To attach local images, choose the reviewer and the image files together in the file picker; make each filename match its `Exhibit:` line. Missing image names are shown on the question so the reference is not silently lost. Direct PDF import extracts selectable text. For other PDFs, attach their exhibit image files alongside the PDF. PDFs made only of scanned images need text extracted first. PDF.js is served from this project, so PDF import does not depend on a third-party CDN.

## Checks

Run `node --test core.test.js` for parser and answer checks. To rebuild the bundled reviewer, install `pypdf` and `pdfplumber`, then run `python build_starter.py "path/to/S2 It0015 - Clean Reviewer.pdf"`.
