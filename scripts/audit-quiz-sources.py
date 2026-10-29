#!/usr/bin/env python3
"""Audit quiz references directly against the retained, supplied PDFs.

This script does not edit questions or fetch outside sources. Literal evidence
is checked without fuzzy matching; semantic fidelity of explanations and the
uniqueness of the intended answer also require the separate editorial review.

    python3 scripts/audit-quiz-sources.py
    python3 scripts/audit-quiz-sources.py --drafts --output /tmp/quiz-draft-audit.json
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata

import fitz


ROOT = Path(__file__).resolve().parents[1]
LEVELS = {"easy", "medium", "hard"}


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha(value):
    return hashlib.sha256(value).hexdigest()


def literal(value):
    """Ignore layout/case/accents, retaining all letter and number content.

    Joining alphanumerics also joins words split by a PDF line-ending hyphen.
    It does not discard numbers, spell-correct, reorder words or fuzzy-match.
    """
    decomposed = unicodedata.normalize("NFKD", str(value)).casefold()
    return "".join(character for character in decomposed if character.isalnum())


def pdf_variants(page, biblical):
    variants = [("native-text", page.get_text("text")),
                ("native-text-visual-order", page.get_text("text", sort=True))]
    if not biblical:
        return variants
    # These supplied AT/NT PDFs use ~10pt body text, with verse markers and
    # footnote markers in smaller spans. Read the actual PDF spans, independently
    # of bible.json and of the importer, preserving body numbers and word order.
    spans = [span for block in page.get_text("dict")["blocks"]
             for line in block.get("lines", []) for span in line["spans"]
             if span["size"] >= 9.5 and span["text"].strip()]
    variants.append(("pdf-body-spans-native-order", " ".join(span["text"] for span in spans)))
    rows = []
    for span in sorted(spans, key=lambda item: (item["origin"][1], item["bbox"][0])):
        baseline = span["origin"][1]
        if rows and abs(rows[-1][0] - baseline) < 1.5:
            rows[-1][1].append(span)
        else:
            rows.append((baseline, [span]))
    ordered = " ".join(" ".join(span["text"] for span in sorted(row, key=lambda item: item["bbox"][0]))
                       for _, row in rows)
    variants.append(("pdf-body-spans-visual-order", ordered))
    return variants


def flatten_bible_drafts(content):
    questions = read(content / "quiz-bible-at.json") + read(content / "quiz-bible-nt.json")
    # Drafts are a flat question bank; compiled quizzes group ten questions.
    return [{"id": "draft-bible", "category": "bible", "questions": questions}]


def audit(root, drafts=False):
    content = root / "content"
    studies = read(content / "studies.json")
    bible = read(content / "bible.json")
    study_quizzes = (read(content / "quiz-study-first.json") + read(content / "quiz-study-second.json")) if drafts else studies["quizzes"]
    bible_quizzes = flatten_bible_drafts(content) if drafts else read(content / "bible-quizzes.json")
    books = {book["id"]: book for book in bible["books"]}
    lessons = {lesson["id"]: lesson for lesson in studies["lessons"]}
    source_files = {source["id"]: source["file"] for source in studies["sources"]}
    source_files.update({"at": "at.pdf", "nt": "nt.pdf"})
    documents, sources, cache, findings, entries = {}, {}, {}, [], []
    ids, prompts, quiz_ids = set(), set(), set()
    bible_questions = [question for quiz in bible_quizzes for question in quiz["questions"]]
    study_questions = [question for quiz in study_quizzes for question in quiz["questions"]]
    counts = {"bibleQuizzes": len(bible_quizzes), "bibleQuestions": len(bible_questions),
              "studyQuizzes": len(study_quizzes), "studyQuestions": len(study_questions),
              "bibleDifficulties": dict(Counter(question.get("difficulty") for question in bible_questions)),
              "studyDifficulties": dict(Counter(question.get("difficulty") for question in study_questions))}

    def issue(question_id, message):
        findings.append({"id": question_id, "message": message})

    if counts["bibleQuestions"] != 120:
        issue("catalog", f"Expected 120 Bible questions, found {counts['bibleQuestions']}.")
    if counts["bibleDifficulties"] != {"easy": 40, "medium": 40, "hard": 40}:
        issue("catalog", "Bible difficulties must contain 40 easy, 40 medium and 40 hard questions.")
    if len(study_quizzes) != 14 or any(len(quiz["questions"]) < 8 for quiz in study_quizzes):
        issue("catalog", "Every one of the fourteen study quizzes must contain at least eight questions.")
    if not drafts and (len(bible_quizzes) != 12 or any(len(quiz["questions"]) != 10 for quiz in bible_quizzes)):
        issue("catalog", "The Bible catalog must have twelve quizzes of ten questions.")

    try:
        for source_id, filename in source_files.items():
            path = content / "source-pdfs" / filename
            if Path(filename).name != filename or not path.is_file():
                issue(source_id, "Missing local supplied PDF or invalid filename.")
                continue
            documents[source_id] = fitz.open(path)
            sources[source_id] = {"file": filename, "sha256": sha(path.read_bytes()), "pages": len(documents[source_id])}

        for category, quizzes in [("bible", bible_quizzes), ("study", study_quizzes)]:
            for quiz in quizzes:
                quiz_id = quiz.get("id") or f"quiz-{quiz.get('lessonId', '')}"
                if quiz_id in quiz_ids:
                    issue(quiz_id, "Duplicate quiz identifier.")
                quiz_ids.add(quiz_id)
                lesson = lessons.get(quiz.get("lessonId"))
                if category == "study" and not lesson:
                    issue(quiz_id, "Study quiz is not attached to an existing lesson.")
                for question in quiz["questions"]:
                    question_id = question.get("id", "<missing-id>")
                    start_findings = len(findings)
                    if question_id in ids:
                        issue(question_id, "Duplicate question identifier.")
                    ids.add(question_id)
                    prompt_key = literal(question.get("prompt", ""))
                    if not prompt_key or prompt_key in prompts:
                        issue(question_id, "Empty or duplicate question prompt.")
                    prompts.add(prompt_key)
                    choices = question.get("choices", [])
                    if len(choices) != 4 or len({literal(choice) for choice in choices}) != 4 or any(not str(choice).strip() for choice in choices):
                        issue(question_id, "Four distinct, nonempty alternatives are required.")
                    answer = question.get("answerIndex")
                    if type(answer) is not int or not 0 <= answer < len(choices):
                        issue(question_id, "Exactly one valid answer index is required.")
                    if question.get("difficulty") not in LEVELS:
                        issue(question_id, "Missing or invalid difficulty.")
                    if not str(question.get("explanation", "")).strip():
                        issue(question_id, "Missing explanatory summary.")
                    if category == "bible" and not drafts and quiz.get("difficulty") != question.get("difficulty"):
                        issue(question_id, "Question difficulty does not match its Bible quiz.")
                    source = question.get("source", {})
                    source_id, page_number = source.get("sourceId"), source.get("page")
                    pages = source.get("pages", [page_number])
                    document = documents.get(source_id)
                    valid_pages = (isinstance(pages, list) and bool(pages)
                                   and all(type(number) is int and document is not None and 1 <= number <= len(document) for number in pages)
                                   and pages == sorted(set(pages)) and page_number == pages[0])
                    if not valid_pages:
                        issue(question_id, "PDF page must exist; pages must be ordered, unique and start at source.page.")
                    reference = None
                    verse_text = None
                    if category == "study" and lesson:
                        if source_id != lesson["sourceId"] or type(page_number) is not int or not lesson["startPage"] <= page_number <= lesson["endPage"]:
                            issue(question_id, "Study source falls outside its lesson.")
                        matching = [section for section in lesson["sections"] if section["sourcePage"] == page_number]
                        if not any(section["reviewStatus"] in {"extracted", "ocr-reviewed"} for section in matching):
                            issue(question_id, "Study question cites an unreviewed or unreadable page.")
                    if category == "bible":
                        book = books.get(source.get("bookId"))
                        chapter = next((item for item in book["chapters"] if item["number"] == source.get("chapter")), None) if book else None
                        first, last = source.get("verseStart"), source.get("verseEnd")
                        valid_range = type(first) is int and type(last) is int and 1 <= first <= last
                        verses = [verse for verse in chapter["verses"] if first <= verse["number"] <= last] if chapter and valid_range else []
                        if not book or not chapter or not valid_range or len(verses) != last - first + 1:
                            issue(question_id, "Bible book, chapter or complete verse range does not exist.")
                        else:
                            if book["name"] != source.get("bookName") or source_id != book["testament"].lower():
                                issue(question_id, "Bible name or testament does not match the reference.")
                            expected_pages = sorted({number for verse in verses for number in verse["sourcePages"]})
                            if pages != expected_pages:
                                issue(question_id, f"PDF pages disagree with the verse provenance: expected {expected_pages}.")
                            reference = f"{book['name']} {source['chapter']}:{first}" + (f"–{last}" if first != last else "")
                            verse_text = " ".join(verse["text"] for verse in verses)
                    evidence = question.get("evidence", "")
                    needle = literal(evidence)
                    evidence_method = None
                    source_text_hash = None
                    if not isinstance(evidence, str) or len(needle) < 20:
                        issue(question_id, "Missing or insufficient literal evidence; provide a meaningful source excerpt.")
                    elif valid_pages:
                        text_variants = []
                        for number in pages:
                            key = (source_id, number)
                            if key not in cache:
                                cache[key] = pdf_variants(document[number - 1], category == "bible")
                            text_variants.append(dict(cache[key]))
                        methods = text_variants[0].keys()
                        for method in methods:
                            text = " ".join(variant[method] for variant in text_variants)
                            if needle in literal(text):
                                evidence_method, source_text_hash = method, sha(text.encode())
                                break
                        if evidence_method is None:
                            issue(question_id, "Literal evidence not found in the cited supplied PDF page(s); no fuzzy substitution was accepted.")
                        if category == "bible" and verse_text and needle not in literal(verse_text):
                            issue(question_id, "Evidence lies outside the cited Bible verse range or differs from its imported text.")
                    entries.append({"id": question_id, "quizId": quiz_id, "category": category,
                                    "difficulty": question.get("difficulty"), "source": source,
                                    "reference": reference, "evidenceSha256": sha(str(evidence).encode()),
                                    "explanationSha256": sha(str(question.get("explanation", "")).encode()),
                                    "sourceTextSha256": source_text_hash, "evidenceMethod": evidence_method,
                                    "verified": len(findings) == start_findings})
    finally:
        for document in documents.values():
            document.close()
    return {"version": 1, "mode": "editorial-drafts" if drafts else "published-catalog",
            "status": "passed" if not findings else "failed", "externalSourcesUsed": False,
            "method": "Strict literal evidence search in the supplied PDF pages; Unicode case/accent and layout normalization preserves letters and numbers. No fuzzy matching or internet source is used.",
            "scope": "Reference integrity, source provenance and literal evidence. This does not replace the separate editorial review of each prompt, alternatives, answer and explanatory assertion.",
            "counts": counts, "sourceFiles": sources, "questions": entries, "findings": findings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--drafts", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    output = args.output or args.root / "content" / "quiz-source-audit.json"
    try:
        report = audit(args.root, args.drafts)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}, ensure_ascii=False))
        return 1
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "counts": report["counts"], "findings": report["findings"], "output": str(output)}, ensure_ascii=False))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
