# Rev

Rev is a local quiz reviewer. Open [index.html](index.html) in a modern browser to use it. Your reviewers and both editable prompts are saved in that browser's local storage. Export a reviewer as JSON to keep a portable backup; JSON can be imported again.

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
Correct! Choice A: EtherChannel
Choice B: VLAN trunking
```

Mark every correct choice with `Correct!` for questions with multiple answers. Choice order is preserved. The app recognizes duplicate question text and keeps a copy with a marked answer when available. An `Exhibit:` line may name an image file, an `https://` image, or a `data:image/...;base64,...` image. To attach local images, choose the reviewer and the image files together in the file picker; make each filename match its `Exhibit:` line. Missing image names are shown on the question so the reference is not silently lost. Direct PDF import extracts selectable text. For other PDFs, attach their exhibit image files alongside the PDF. PDFs made only of scanned images need text extracted first. PDF.js is loaded from a CDN for direct PDF import.

## Checks

Run `node --test core.test.js` for parser and answer checks. To rebuild the bundled reviewer, install `pypdf` and `pdfplumber`, then run `python build_starter.py "path/to/S2 It0015 - Clean Reviewer.pdf"`.
