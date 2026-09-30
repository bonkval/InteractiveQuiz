"""Rebuild the bundled reviewer from the source PDF's text layout."""
import json
import re
import sys
from pathlib import Path
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "S2 It0015 - Clean Reviewer.pdf"
OUTPUT = ROOT / "reviewer-data.js"


def main():
    reader = PdfReader(SOURCE)
    questions = []
    current = None
    last_option_y = None
    last_page = None

    for page_number, page in enumerate(reader.pages):
        rows = []

        def collect(value, _cm, tm, _font, _size):
            if value.strip():
                rows.append((round(tm[4]), tm[5], value.strip()))

        page.extract_text(visitor_text=collect)
        for x, y, line in rows:
            if x >= 500:
                continue
            heading = re.fullmatch(r"Question\s+(\d+)", line, re.I)
            if heading:
                current = {
                    "sourceNumber": heading.group(1),
                    "text": "",
                    "options": [],
                    "correctAnswers": [],
                }
                questions.append(current)
                last_option_y = None
                continue
            if current is None:
                continue
            if x < 80:
                current["text"] += ("\n" if current["text"] else "") + line
                last_option_y = None
                continue
            marked = re.match(r"^Correct!\s*(.*)$", line, re.I)
            scored = re.match(r"^(?:You Answered\s+)?(.*?)\s*\((correct|wrong)\)$", line, re.I)
            text = marked.group(1) if marked else scored.group(1) if scored else line
            is_correct = bool(marked or (scored and scored.group(2).lower() == 'correct'))
            continuation = (
                current["options"]
                and last_page == page_number
                and last_option_y is not None
                and 0 < last_option_y - y < 17
                and not (marked or scored)
            )
            if continuation:
                current["options"][-1] += "\n" + text
            else:
                if is_correct:
                    current["correctAnswers"].append(len(current["options"]))
                current["options"].append(text)
            last_option_y = y
            last_page = page_number

    for q in questions:
        q["type"] = "boolean" if len(q["options"]) == 2 and {x.lower() for x in q["options"]} == {"true", "false"} else "choice"
    assert len(questions) == 170, f"Expected 170 questions, got {len(questions)}"
    assert all(q["text"] and q["options"] and q["correctAnswers"] for q in questions)
    result = {
        "id": "reviewer-s2-it0015",
        "title": "S2 It0015 - Clean Reviewer",
        "questions": questions,
        "source": SOURCE.name,
    }
    OUTPUT.write_text("window.RECALL_STARTER_REVIEWER = " + json.dumps(result, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    from collections import Counter
    print("Questions:", len(questions), "choice counts:", dict(Counter(len(q["options"]) for q in questions)))


if __name__ == "__main__":
    main()
