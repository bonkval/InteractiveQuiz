# Recall — local quiz reviewer

A simple, browser-based quiz reviewer. Questions and answers are stored in your browser and never sent to an app server.

## Run it

Open `index.html` in a modern browser. PDF import uses PDF.js from a CDN, so allow internet access while loading a PDF. You can also paste extracted text or import a plain text/Markdown file.

## Reviewer format

Questions can use `Question 1` headings. Put each answer choice on its own line, and prefix the correct choice with `Correct! `:

```text
Question 1
What does STP prevent?
prevents routing loops
Correct! prevents Layer 2 loops
creates smaller domains
```

True/False, multiple answer questions (multiple `Correct!` options), fill-in answers, and dropdown style options are supported. Option order and source text remain as imported. The quiz can shuffle question order without moving answer choices.

## Data

Reviewers are stored in local browser storage. Export each reviewer as JSON from its start screen to keep a portable backup.
