import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const studies = JSON.parse(readFileSync(path.join(root, 'content/studies.json'), 'utf8'));
const section = (sourceId, page) => studies.lessons.filter(lesson => lesson.sourceId === sourceId)
  .flatMap(lesson => lesson.sections).find(item => item.sourcePage === page);
const svg = (filename) => readFileSync(path.join(publicRoot, 'study-visuals/study-1', filename), 'utf8');
const normalized = value => value.replace(/\s+/g, ' ').trim();
const svgText = value => normalized([...value.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1]).join(' '));

test('o gráfico preserva 39 e 27 livros, escala comum e proporções das barras nos dois temas', () => {
  const sourceSection = section('study-1', 3);
  assert.ok(sourceSection?.visuals?.some(visual => visual.kind === 'chart'));
  assert.match(sourceSection.readingText, /Antigo Testamento: 39 livros/);
  assert.match(sourceSection.readingText, /Novo Testamento: 27 livros/);
  assert.doesNotMatch(sourceSection.displayBody, /Antigo Testamento\s+39\s+Novo Testamento\s+27/);
  for (const theme of ['light', 'dark']) {
    const content = svg(`p003-books-${theme}.svg`);
    const bars = [...content.matchAll(/<rect\b([^>]*data-category="[^"]+"[^>]*)\/>/g)].map(([, attributes]) => ({
      category: attributes.match(/data-category="([^"]+)"/)[1],
      value: Number(attributes.match(/data-value="([^"]+)"/)[1]),
      width: Number(attributes.match(/\bwidth="([^"]+)"/)[1]),
    }));
    assert.deepEqual(bars.map(({ category, value }) => [category, value]), [['Antigo Testamento', 39], ['Novo Testamento', 27]]);
    assert.ok(Math.abs(bars[0].width / bars[1].width - 39 / 27) < 0.000001);
    const ticks = [...content.matchAll(/<text\b[^>]*y="387"[^>]*>(\d+)<\/text>/g)].map(match => Number(match[1]));
    assert.deepEqual(ticks, [0, 10, 20, 30, 40]);
    assert.match(content, /Fonte: Jornada da Bíblia — Parte 1 · p\. 3/);
  }
});

test('cada autor permanece ligado à sua descrição e a nota original não é perdida', () => {
  const expected = [
    ['Moisés', 'Legislador e libertador do povo hebreu.'],
    ['Davi', 'Poeta e rei de Israel, autor de diversos salmos.'],
    ['Isaías', 'Profeta que anunciou a vinda do Messias.'],
    ['Mateus', 'Cobrador de impostos transformado em discípulo.'],
    ['Lucas', 'Médico e historiador detalhista.'],
    ['Paulo', 'Apóstolo e missionário, autor de grande parte das cartas cristãs.'],
    ['João', 'Discípulo amado de Cristo, escreveu sobre o amor e a esperança eterna.'],
  ];
  const note = 'Cada um, em seu contexto, foi movido pelo Espírito Santo para registrar verdades espirituais que continuam relevantes até hoje.';
  const sourceSection = section('study-1', 4);
  const visual = sourceSection?.visuals?.find(item => item.kind === 'table');
  assert.ok(visual);
  for (const [name, description] of expected) assert.ok(visual.accessibleText.includes(`${name}: ${description}`), name);
  assert.ok(sourceSection.readingText.includes(note));
  for (const theme of ['light', 'dark']) {
    const content = svg(`p004-authors-${theme}.svg`);
    const rows = [...content.matchAll(/<g data-author="([^"]+)">([\s\S]*?)<\/g>/g)];
    assert.equal(rows.length, expected.length);
    expected.forEach(([name, description], index) => {
      assert.equal(rows[index][1], name);
      assert.equal(svgText(rows[index][2]), `${name} ${description}`);
    });
    assert.ok(svgText(content).includes(note));
  }
});

test('as imagens cobrem os quadros raster e vetoriais e usam apenas assets locais válidos', () => {
  // These source pages contain visual relationships that linear text extraction
  // lost: a vector chart/table, a numeric header/timeline, raster composites and
  // the four full-page Gospel diagrams. An embedded-image-only importer misses them.
  for (const [sourceId, page] of [['study-1', 3], ['study-1', 4], ['study-1', 5], ['study-1', 6], ['study-1', 8], ['study-1', 11], ['study-3', 3], ['study-4', 3]]) {
    assert.ok(section(sourceId, page)?.visuals?.length, `${sourceId}, página ${page}`);
  }
  for (let page = 2; page <= 89; page++) assert.ok(section('study-2', page)?.visuals?.length, `Parte 2, página ${page}`);
  for (let page = 1; page <= 4; page++) {
    const item = section('gospels', page);
    assert.ok(item?.visuals?.length, `Evangelhos, página ${page}`);
    assert.equal(item.reviewStatus, 'needs-review');
    assert.equal(item.readingText, '', 'Uma imagem legível não valida automaticamente o OCR do quadro.');
  }
  const seenIds = new Set();
  const seenAssets = new Set();
  for (const lesson of studies.lessons) {
    const source = studies.sources.find(item => item.id === lesson.sourceId);
    for (const item of lesson.sections) for (const visual of item.visuals ?? []) {
      assert.ok(source && item.sourcePage >= 1 && item.sourcePage <= source.totalPages);
      assert.ok(!seenIds.has(visual.id), `Figura duplicada: ${visual.id}`);
      seenIds.add(visual.id);
      assert.ok(visual.title.trim() && visual.description.trim());
      assert.ok(visual.width > 0 && visual.height > 0);
      for (const asset of [visual.lightSrc, visual.darkSrc].filter(Boolean)) {
        assert.match(asset, /^\/study-visuals\/[a-z0-9-]+\/[a-z0-9-]+\.(?:svg|webp|png)$/);
        const filename = path.resolve(publicRoot, asset.slice(1));
        assert.ok(filename.startsWith(`${publicRoot}${path.sep}`));
        assert.ok(existsSync(filename) && statSync(filename).isFile(), asset);
        if (seenAssets.has(asset)) continue;
        seenAssets.add(asset);
        const bytes = readFileSync(filename);
        if (asset.endsWith('.svg')) {
          const text = bytes.toString('utf8');
          assert.match(text, /<svg\b/);
          assert.doesNotMatch(text, /<script\b|<foreignObject\b|\bonload\s*=|javascript:/i);
          assert.doesNotMatch(text, /\b(?:href|src)\s*=\s*["'](?:https?:)?\/\//i);
        } else if (asset.endsWith('.webp')) {
          assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
          assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
        } else {
          assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        }
      }
    }
  }
  assert.ok(seenIds.size >= 130, `Somente ${seenIds.size} páginas visuais receberam representação.`);
  const audit = JSON.parse(readFileSync(path.join(root, 'content/study-visual-audit.json'), 'utf8'));
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(audit.visualSections, seenIds.size);
  for (const original of audit.sources) {
    const source = studies.sources.find(item => item.id === original.id);
    assert.ok(source, original.id);
    assert.equal(sha256(readFileSync(path.join(root, 'content/source-pdfs', source.file))), original.sha256, original.id);
  }
  const auditedAssets = new Set();
  for (const entry of audit.entries) {
    const item = section(entry.sourceId, entry.sourcePage);
    assert.ok(item?.visuals?.length);
    assert.equal(sha256(item.body), entry.bodySha256, 'A apresentação não deve sobrescrever a transcrição de origem.');
    for (const asset of entry.assets) {
      assert.ok(seenAssets.has(asset.url), asset.url);
      const bytes = readFileSync(path.join(publicRoot, asset.url.slice(1)));
      assert.equal(bytes.length, asset.bytes, asset.url);
      assert.equal(sha256(bytes), asset.sha256, asset.url);
      auditedAssets.add(asset.url);
    }
  }
  assert.deepEqual([...auditedAssets].sort(), [...seenAssets].sort());
});
