import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = filename => JSON.parse(readFileSync(path.join(root, 'content', filename), 'utf8'));
const studies = read('studies.json');
const bible = read('bible.json');
const bibleQuizzes = read('bible-quizzes.json');
const audit = read('quiz-source-audit.json');
const hash = value => createHash('sha256').update(value).digest('hex');
const normalized = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');

test('a revisão independente cobre as 232 perguntas publicadas e corresponde aos bancos atuais', () => {
  const published = new Map([...studies.quizzes, ...bibleQuizzes].flatMap(quiz => quiz.questions).map(question => [question.id, question]));
  const reviewed = new Set();
  for (const testament of ['at', 'nt']) {
    const review = read(`quiz-review-${testament}.json`);
    const bankFile = `quiz-bible-${testament}.json`;
    assert.equal(review.reviewed, 60);
    assert.equal(hash(readFileSync(path.join(root, 'content', bankFile))), review.bankSha256);
    assert.equal(hash(readFileSync(path.join(root, 'content/source-pdfs', review.source.file))), review.source.sha256);
    const results = review.results ?? review.questions;
    assert.equal(results.length, 60);
    for (const result of results) {
      assert.ok(['approved', 'approved-after-correction'].includes(result.status) || (result.correctAnswerSupported && result.summarySupported && result.singleCorrectAlternative));
      reviewed.add(result.id);
    }
    for (const question of read(bankFile)) assert.deepEqual(published.get(question.id), question);
  }
  const review = read('quiz-review-study.json');
  assert.equal(review.reviewed, 112);
  for (const source of review.sources) assert.equal(hash(readFileSync(path.join(root, 'content/source-pdfs', source.file))), source.sha256);
  for (const bank of review.questionBanks) {
    assert.equal(hash(readFileSync(path.join(root, 'content', bank.file))), bank.sha256);
    for (const question of read(bank.file).flatMap(quiz => quiz.questions)) assert.deepEqual(published.get(question.id), question);
  }
  for (const result of review.results) {
    assert.ok(['approved', 'approved-after-correction'].includes(result.status));
    assert.equal(result.semanticReview.allExplanationClaimsWithinCitedPage, true);
    reviewed.add(result.id);
  }
  assert.deepEqual([...reviewed].sort(), [...published.keys()].sort());
});

test('o quiz da Bíblia tem 120 questões próprias em três níveis, com referências completas', () => {
  assert.equal(bibleQuizzes.length, 12);
  const questions = bibleQuizzes.flatMap(quiz => quiz.questions);
  assert.equal(questions.length, 120);
  const levels = { easy: 0, medium: 0, hard: 0 };
  const testaments = { at: 0, nt: 0 };
  for (const quiz of bibleQuizzes) {
    assert.equal(quiz.category, 'bible');
    assert.equal(quiz.questions.length, 10);
    assert.ok(Object.hasOwn(levels, quiz.difficulty));
    for (const question of quiz.questions) {
      assert.equal(question.difficulty, quiz.difficulty);
      levels[question.difficulty]++;
      const source = question.source;
      assert.ok(Object.hasOwn(testaments, source.sourceId));
      testaments[source.sourceId]++;
      const book = bible.books.find(item => item.id === source.bookId);
      assert.ok(book, question.id);
      assert.equal(source.bookName, book.name);
      assert.equal(source.sourceId, book.testament.toLowerCase());
      const chapter = book.chapters.find(item => item.number === source.chapter);
      assert.ok(chapter, question.id);
      assert.ok(Number.isInteger(source.verseStart) && Number.isInteger(source.verseEnd) && source.verseEnd >= source.verseStart);
      const verses = chapter.verses.filter(verse => verse.number >= source.verseStart && verse.number <= source.verseEnd);
      assert.equal(verses.length, source.verseEnd - source.verseStart + 1, question.id);
      const expectedPages = [...new Set(verses.flatMap(verse => verse.sourcePages))].sort((a, b) => a - b);
      assert.deepEqual(source.pages ?? [source.page], expectedPages, question.id);
      assert.equal(source.page, expectedPages[0]);
    }
  }
  assert.deepEqual(levels, { easy: 40, medium: 40, hard: 40 });
  assert.deepEqual(testaments, { at: 60, nt: 60 });
});

test('os quatorze quizzes de estudo crescem sem reinterpretar respostas da versão anterior', () => {
  assert.equal(studies.quizzes.length, 14);
  for (const quiz of studies.quizzes) {
    assert.ok(quiz.questions.length >= 8, quiz.id);
    assert.equal(quiz.revision, 2, quiz.id);
    const previous = quiz.previousVersions?.find(version => version.revision === 1);
    assert.ok(previous, `${quiz.id}: preservar o histórico anterior.`);
    assert.equal(previous.questions.length, 2);
    for (const original of previous.questions) {
      const revised = quiz.questions.find(question => question.id === original.id);
      assert.ok(revised, original.id);
      assert.deepEqual(revised.choices, original.choices, original.id);
      assert.equal(revised.answerIndex, original.answerIndex, original.id);
      assert.deepEqual(revised.source, original.source, original.id);
    }
  }
});

test('todas as perguntas têm alternativas distintas, evidência e auditoria da fonte vigente', () => {
  const questions = [...studies.quizzes, ...bibleQuizzes].flatMap(quiz => quiz.questions);
  const ids = new Set();
  const prompts = new Set();
  assert.equal(audit.status, 'passed');
  assert.equal(audit.mode, 'published-catalog');
  assert.equal(audit.externalSourcesUsed, false);
  assert.equal(audit.findings.length, 0);
  assert.equal(audit.questions.length, questions.length);
  assert.equal(audit.counts.bibleQuestions, 120);
  assert.ok(audit.counts.studyQuestions >= 112);
  for (const [sourceId, source] of Object.entries(audit.sourceFiles)) {
    assert.equal(path.basename(source.file), source.file, sourceId);
    const bytes = readFileSync(path.join(root, 'content/source-pdfs', source.file));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal(hash(bytes), source.sha256, sourceId);
  }
  const records = new Map(audit.questions.map(record => [record.id, record]));
  assert.equal(records.size, questions.length);
  for (const question of questions) {
    assert.ok(!ids.has(question.id), question.id); ids.add(question.id);
    const prompt = normalized(question.prompt);
    assert.ok(prompt && !prompts.has(prompt), question.id); prompts.add(prompt);
    assert.equal(question.choices.length, 4);
    assert.equal(new Set(question.choices.map(normalized)).size, 4, question.id);
    assert.ok(question.choices.every(choice => choice.trim()));
    assert.ok(Number.isInteger(question.answerIndex) && question.answerIndex >= 0 && question.answerIndex < 4);
    assert.ok(['easy', 'medium', 'hard'].includes(question.difficulty), question.id);
    assert.ok(question.explanation.trim() && normalized(question.evidence).length >= 20, question.id);
    const record = records.get(question.id);
    assert.ok(record?.verified && record.evidenceMethod && record.sourceTextSha256, question.id);
    assert.deepEqual(record.source, question.source, question.id);
    assert.equal(record.evidenceSha256, hash(question.evidence), question.id);
    assert.equal(record.explanationSha256, hash(question.explanation), question.id);
    const source = audit.sourceFiles[question.source.sourceId];
    assert.ok(source && question.source.page >= 1 && question.source.page <= source.pages, question.id);
  }
});
