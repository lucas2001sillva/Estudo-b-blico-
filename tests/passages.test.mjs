import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const content = new URL('../content/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, content), 'utf8'));
const bible = read('bible.json');
const passages = read('passages.json');

test('cada passagem informa o PDF e as páginas dos versículos, em vez da primeira página do capítulo', () => {
  assert.equal(passages.length, 50);
  for (const passage of passages) {
    const book = bible.books.find(item => item.id === passage.bookId);
    const chapter = book.chapters.find(item => item.number === passage.chapter);
    const verses = chapter.verses.filter(verse => verse.number >= passage.verseStart && verse.number <= passage.verseEnd);
    const pages = [...new Set(verses.flatMap(verse => verse.sourcePages))].sort((a, b) => a - b);
    assert.equal(passage.version, 'NVI');
    assert.equal(passage.source.sourceId, book.testament.toLowerCase());
    assert.equal(passage.source.file, `${book.testament.toLowerCase()}.pdf`);
    assert.deepEqual(passage.source.pages, pages, passage.id);
    assert.ok(pages.length && pages.every(page => Number.isInteger(page) && page > 0));
    assert.equal(readFileSync(new URL(`source-pdfs/${passage.source.file}`, content)).subarray(0, 5).toString(), '%PDF-');
    assert.equal(passage.text, verses.map(verse => verse.text).join(' '));
  }
  assert.equal(passages.find(passage => passage.bookId === 'salmos' && passage.chapter === 119).source.pages[0], 623);
  assert.equal(passages.find(passage => passage.bookId === '1-cronicas').source.pages[0], 356);
  assert.equal(passages.find(passage => passage.bookId === 'romanos' && passage.chapter === 8).source.pages[0], 160);
});
