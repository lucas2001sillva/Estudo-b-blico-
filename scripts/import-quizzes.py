#!/usr/bin/env python3
"""Update only quiz collections from the versioned, source-checked editorial banks."""
import json
from pathlib import Path
from quiz_catalog import bible_quizzes, study_quizzes

ROOT = Path(__file__).resolve().parents[1]


def main():
    content = ROOT / 'content'
    studies = json.loads((content / 'studies.json').read_text(encoding='utf-8'))
    studies['quizzes'] = study_quizzes(content)
    bible = bible_quizzes(content)
    (content / 'studies.json').write_text(json.dumps(studies, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (content / 'bible-quizzes.json').write_text(json.dumps(bible, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'studyQuizzes': len(studies['quizzes']), 'studyQuestions': sum(len(q['questions']) for q in studies['quizzes']),
                      'bibleQuizzes': len(bible), 'bibleQuestions': sum(len(q['questions']) for q in bible)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
