# Rev

Rev is a local quiz reviewer. Open [index.html](index.html) in a modern browser to use it. Your reviewers and both editable prompts are saved in that browser's local storage. Export a reviewer as JSON to keep a portable backup; JSON can be imported again.

The bundled S2 It0015 reviewer was rebuilt from the source PDF. It has 170 questions: 147 with four choices and 23 True/False. The app updates the earlier malformed bundled copy in local storage when it recognizes it.

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
```

Mark every correct choice with `Correct!` for questions with multiple answers. Choice order is preserved. The app recognizes duplicate question text and keeps a copy with a marked answer when available. Direct PDF import works for selectable text; PDFs made only of scanned images need text extracted first. PDF.js is loaded from a CDN for direct PDF import.

## Checks

Run `node --test core.test.js` for parser and answer checks. To rebuild the bundled reviewer, run `python build_starter.py "path/to/S2 It0015 - Clean Reviewer.pdf"`.
