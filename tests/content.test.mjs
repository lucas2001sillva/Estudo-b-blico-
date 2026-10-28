import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(readFileSync(path.join(root, 'content', name), 'utf8'));
const bible = read('bible.json');
const passages = read('passages.json');
const studies = read('studies.json');

test('o conteúdo bíblico possui 66 livros, 1.189 capítulos e referências únicas e ordenadas', () => {
  assert.equal(bible.books.length, 66);
  assert.equal(new Set(bible.books.map(book => book.id)).size, 66);
  assert.equal(bible.books.reduce((sum, book) => sum + book.chapters.length, 0), 1189);
  assert.equal(bible.books.filter(book => book.testament === 'AT').length, 39);
  assert.equal(bible.books.filter(book => book.testament === 'NT').length, 27);
  for (const book of bible.books) {
    book.chapters.forEach((chapter, index) => {
      assert.equal(chapter.number, index + 1, book.name);
      assert.ok(chapter.verses.length > 0, `${book.name} ${chapter.number}`);
      assert.ok(chapter.sourcePages.length > 0);
      let previous = 0;
      for (const verse of chapter.verses) {
        assert.ok(verse.number > previous, `${book.name} ${chapter.number}:${verse.number}`);
        assert.ok(verse.text.trim().length > 0);
        previous = verse.number;
      }
    });
  }
});

test('as 50 passagens são referências distintas e reproduzem os versículos importados', () => {
  assert.equal(passages.length, 50);
  const references = new Set();
  for (const passage of passages) {
    const book = bible.books.find(item => item.id === passage.bookId);
    assert.ok(book, passage.bookId);
    const chapter = book.chapters.find(item => item.number === passage.chapter);
    assert.ok(chapter);
    const verses = chapter.verses.filter(verse => verse.number >= passage.verseStart && verse.number <= passage.verseEnd);
    assert.equal(verses.length, passage.verseEnd - passage.verseStart + 1);
    assert.equal(passage.text, verses.map(verse => verse.text).join(' '));
    assert.equal(passage.bookName, book.name);
    references.add(`${book.id}:${passage.chapter}:${passage.verseStart}:${passage.verseEnd}`);
  }
  assert.equal(references.size, 50);
});

test('todas as trilhas livres e lições apontam para fontes e páginas existentes', () => {
  assert.ok(studies.trails.some(trail => trail.recommended));
  const lessonIds = new Set(studies.lessons.map(lesson => lesson.id));
  assert.equal(lessonIds.size, studies.lessons.length);
  for (const trail of studies.trails) {
    assert.ok(trail.lessonIds.length > 0);
    for (const id of trail.lessonIds) assert.ok(lessonIds.has(id), id);
  }
  for (const lesson of studies.lessons) {
    const source = studies.sources.find(item => item.id === lesson.sourceId);
    const trail = studies.trails.find(item => item.id === lesson.trailId);
    assert.ok(source && trail?.lessonIds.includes(lesson.id), lesson.id);
    assert.ok(lesson.startPage >= 1 && lesson.endPage <= source.totalPages);
    assert.ok(lesson.sections.length > 0);
    for (const section of lesson.sections) {
      assert.ok(section.sourcePage >= lesson.startPage && section.sourcePage <= lesson.endPage);
      assert.ok(['extracted', 'ocr-extracted', 'ocr-reviewed', 'needs-review'].includes(section.reviewStatus));
      if (section.reviewStatus !== 'needs-review') assert.ok(section.body.trim().length > 0);
    }
  }
});

test('os quizzes têm gabarito válido e não usam páginas marcadas como duvidosas', () => {
  const ids = new Set();
  let count = 0;
  for (const quiz of studies.quizzes) {
    assert.ok(studies.lessons.some(lesson => lesson.id === quiz.lessonId));
    assert.ok(quiz.questions.length > 0);
    for (const question of quiz.questions) {
      assert.ok(!ids.has(question.id), question.id); ids.add(question.id);
      assert.ok(question.choices.length >= 2 && new Set(question.choices).size === question.choices.length);
      assert.ok(Number.isInteger(question.answerIndex) && question.answerIndex >= 0 && question.answerIndex < question.choices.length);
      assert.ok(question.prompt.trim() && question.explanation.trim());
      const source = studies.sources.find(item => item.id === question.source.sourceId);
      assert.ok(source && question.source.page > 0 && question.source.page <= source.totalPages);
      const sections = studies.lessons.filter(lesson => lesson.sourceId === question.source.sourceId).flatMap(lesson => lesson.sections).filter(section => section.sourcePage === question.source.page);
      assert.ok(sections.some(section => section.reviewStatus === 'extracted' || section.reviewStatus === 'ocr-reviewed'), question.id);
      count += 1;
    }
  }
  assert.ok(count >= 24);
});

test('os sete PDFs de consulta estão presentes e têm assinatura PDF', () => {
  const filenames = ['at.pdf', 'nt.pdf', ...studies.sources.map(source => source.file)];
  assert.equal(new Set(filenames).size, 7);
  for (const file of filenames) {
    assert.equal(path.basename(file), file);
    const filename = path.join(root, 'content/source-pdfs', file);
    assert.ok(existsSync(filename));
    assert.equal(readFileSync(filename).subarray(0, 5).toString(), '%PDF-');
  }
});
