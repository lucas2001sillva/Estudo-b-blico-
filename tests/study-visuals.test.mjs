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
const nativeText = item => (item.blocks ?? []).filter(block => block.kind === 'text').map(block => block.text).join('\n\n');
const plannedPageCount = () => studies.lessons.reduce((count, lesson) => count + lesson.sections.length, 0);
const plans = ['visual-regions-study2a.json', 'visual-regions-study2b.json', 'visual-regions-native.json']
  .flatMap(filename => JSON.parse(readFileSync(path.join(root, 'content', filename), 'utf8')));
const svgText = value => normalized([...value.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1]).join(' '));

test('o gráfico preserva 39 e 27 livros, escala comum e proporções das barras nos dois temas', () => {
  const sourceSection = section('study-1', 3);
  assert.ok(sourceSection?.visuals?.some(visual => visual.kind === 'chart'));
  assert.match(sourceSection.readingText, /Antigo Testamento: 39 livros/);
  assert.match(sourceSection.readingText, /Novo Testamento: 27 livros/);
  assert.doesNotMatch(nativeText(sourceSection), /Antigo Testamento\s+39\s+Novo Testamento\s+27/);
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

test('parágrafos permanecem texto e somente as regiões gráficas recebem figuras', () => {
  const expectedPages = new Set(studies.lessons.flatMap(lesson => lesson.sections.map(item => `${lesson.sourceId}:${item.sourcePage}`)));
  const plannedPages = new Set(plans.map(item => `${item.sourceId}:${item.sourcePage}`));
  assert.equal(plans.length, plannedPages.size, 'Uma página não pode possuir planos concorrentes.');
  assert.deepEqual([...plannedPages].sort(), [...expectedPages].sort(), 'Todas as páginas de estudo precisam ser classificadas.');
  for (const plan of plans) {
    const item = section(plan.sourceId, plan.sourcePage);
    assert.ok(Array.isArray(item.blocks), `${plan.sourceId}, página ${plan.sourcePage}`);
    const visuals = new Map((item.visuals ?? []).map(visual => [visual.id, visual]));
    for (const block of item.blocks) {
      assert.ok(block.kind === 'text' || block.kind === 'visual');
      if (block.kind === 'text') assert.ok(block.text.trim(), 'Texto comum deve continuar disponível como texto do site.');
      else assert.ok(visuals.has(block.visualId), 'O bloco visual deve referenciar uma figura existente.');
    }
    if (plan.figures.length === 0) {
      assert.equal(visuals.size, 0, `${plan.sourceId}, página ${plan.sourcePage}: prosa não vira imagem.`);
      if (item.reviewStatus !== 'needs-review') assert.ok(nativeText(item).length > 0);
    }
    for (const figure of plan.figures) {
      const [x0, y0, x1, y1] = figure.rect;
      assert.ok(x1 > x0 && y1 > y0, `${plan.sourceId}, página ${plan.sourcePage}: recorte vazio.`);
      // Study PDFs are A4, except the larger Gospel boards. A graph may fill
      // much of a page, but its region must not be the old full A4 fallback.
      if (plan.sourceId !== 'gospels') assert.ok(x0 > 0 || y0 > 0 || x1 < 590 || y1 < 835,
        `${plan.sourceId}, página ${plan.sourcePage}: não aceitar captura da página inteira.`);
    }
  }
  const introduction = section('study-2', 2);
  assert.equal(introduction.visuals?.length ?? 0, 0);
  assert.match(nativeText(introduction), /O Antigo Testamento constitui a primeira grande parte/);
  assert.match(introduction.readingText, /O Antigo Testamento constitui a primeira grande parte/);
  for (const [page, phrase] of [[3, /autoria de Gênesis/], [14, /tradição judaico-cristã/]]) {
    const item = section('study-2', page);
    assert.ok(item.visuals?.length, `Cabeçalho/quadros da página ${page} devem continuar visuais.`);
    assert.match(nativeText(item), phrase, `A prosa da página ${page} não pode ficar dentro da imagem.`);
    assert.ok(item.blocks.some(block => block.kind === 'visual'));
    assert.ok(item.blocks.some(block => block.kind === 'text'));
  }
  const genesis = section('study-2', 3);
  for (const phrase of ['Deus cria', 'Caim', 'família']) {
    assert.ok(nativeText(genesis).includes(phrase), `A transcrição conferida deve preservar ${phrase}.`);
    assert.ok(genesis.readingText.includes(phrase));
  }
});

test('as figuras recriadas usam assets locais seguros e mantêm a integridade das fontes', () => {
  for (const [sourceId, page] of [['study-1', 3], ['study-1', 4], ['study-3', 3], ['study-4', 3]]) {
    assert.ok(section(sourceId, page)?.visuals?.length, `${sourceId}, página ${page}`);
  }
  for (let page = 1; page <= 4; page++) {
    const item = section('gospels', page);
    assert.equal(item.reviewStatus, 'needs-review');
    assert.equal(item.readingText, '', 'Diagramas parciais não validam automaticamente o conteúdo ilegível.');
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
      assert.ok(visual.accessibleText?.trim(), `A figura ${visual.id} precisa de conteúdo para leitura em voz alta.`);
      assert.ok(visual.width > 0 && visual.height > 0);
      assert.notEqual(visual.kind, 'page', 'Somente a figura deve ser representada como imagem.');
      assert.equal(visual.redrawn, true, 'As imagens precisam ser recriadas no estilo do site.');
      for (const asset of [visual.lightSrc, visual.darkSrc].filter(Boolean)) {
        assert.match(asset, /^\/study-visuals\/[a-z0-9-]+\/[a-z0-9-]+\.(?:svg|png)$/);
        assert.doesNotMatch(asset, /\/p\d{3}\.webp$/, 'A captura anterior de página inteira não pode voltar.');
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
          assert.doesNotMatch(text, /<image\b/i, 'SVG novo deve conter elementos gráficos/texto, sem bitmap de página.');
          assert.doesNotMatch(text, /\b(?:href|src)\s*=\s*["'](?:https?:)?\/\//i);
        } else {
          assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        }
      }
    }
  }
  assert.ok(seenIds.size > 50, 'Os quadros claros dos livros devem continuar representados.');
  const audit = JSON.parse(readFileSync(path.join(root, 'content/study-visual-audit.json'), 'utf8'));
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(audit.version, 2);
  assert.equal(audit.fullPageImages, 0, 'Nenhuma página completa deve ser usada como imagem.');
  assert.equal(audit.sections, plannedPageCount(), 'A auditoria cobre todas as páginas do estudo.');
  for (const original of audit.sources) {
    const source = studies.sources.find(item => item.id === original.id);
    assert.ok(source, original.id);
    assert.equal(sha256(readFileSync(path.join(root, 'content/source-pdfs', source.file))), original.sha256, original.id);
  }
  for (const entry of audit.entries) {
    const item = section(entry.sourceId, entry.sourcePage);
    assert.ok(item);
    assert.equal(sha256(item.body), entry.bodySha256, 'A apresentação não deve sobrescrever a transcrição de origem.');
    assert.notEqual(entry.mode, 'faithful-composite');
    const expectedFigures = (entry.figures ?? []).filter(figure => figure.status === 'redrawn');
    assert.equal((item.visuals ?? []).length, expectedFigures.length, 'Uma figura em conferência não vira imagem inventada.');
  }
  const auditedAssets = new Set();
  const inspectAudit = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.url === 'string' && value.url.startsWith('/study-visuals/')) {
      assert.ok(seenAssets.has(value.url), value.url);
      const bytes = readFileSync(path.join(publicRoot, value.url.slice(1)));
      assert.equal(bytes.length, value.bytes, value.url);
      assert.equal(sha256(bytes), value.sha256, value.url);
      auditedAssets.add(value.url);
    }
    for (const item of Object.values(value)) inspectAudit(item);
  };
  inspectAudit(audit);
  assert.deepEqual([...auditedAssets].sort(), [...seenAssets].sort());
});
