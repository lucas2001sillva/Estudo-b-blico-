import { expect, test, type Page } from '@playwright/test';

async function studies(page: Page) {
  await page.getByRole('link', { name: 'Estudos', exact: true }).filter({ visible: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Um assunto de cada vez.', exact: true })).toBeVisible();
}

async function openLesson(page: Page, title: string) {
  await page.locator('.study-lesson-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).click();
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
}

async function expectLoaded(image: ReturnType<Page['locator']>) {
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await image.evaluate(async element => {
    await (element as HTMLImageElement).decode();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function captureSpeech(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    Object.defineProperty(window, '__studySpoken', { value: spoken });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {}, pause() {}, resume() {}, getVoices() { return []; }, paused: false,
        speak(utterance: SpeechSynthesisUtterance) {
          spoken.push(utterance.text);
          window.setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 0);
        },
      },
    });
  });
}

test('gráfico e autores aparecem como imagens fiéis, com tema, descrição e ampliação por teclado', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await studies(page);
  await openLesson(page, 'Conhecendo a Bíblia');
  const chart = page.locator('figure.study-visual').filter({ has: page.getByRole('heading', { name: 'Total de livros por testamento', exact: true }) });
  const chartImage = chart.locator('.study-visual-preview img');
  await expectLoaded(chartImage);
  await expect(chartImage).toHaveAttribute('src', /p003-books-light\.svg$/);
  await expect(chartImage).toHaveAttribute('alt', /Antigo Testamento, 39 livros; Novo Testamento, 27 livros/);
  await chart.screenshot({ path: testInfo.outputPath('intro-chart-light.png') });
  const sourceSection = page.locator('.study-text-section').filter({ has: chart });
  const paragraphs = await sourceSection.locator('.study-section-body p').allTextContents();
  expect(paragraphs.some(value => /^(?:0|10|20|30|40|39|27)$/.test(value.trim()))).toBe(false);
  await chart.getByText('Ler descrição da imagem', { exact: true }).click();
  await expect(chart.locator('.study-visual-description-body')).toContainText('Antigo Testamento: 39 livros. Novo Testamento: 27 livros.');
  const authors = page.locator('figure.study-visual').filter({ has: page.getByRole('heading', { name: 'Destaques sobre os autores da Bíblia', exact: true }) });
  await expectLoaded(authors.locator('.study-visual-preview img'));
  await authors.screenshot({ path: testInfo.outputPath('intro-authors-light.png') });
  await authors.getByText('Ler descrição da imagem', { exact: true }).click();
  await expect(authors.locator('.study-visual-description-body')).toContainText('Moisés: Legislador e libertador do povo hebreu.');
  await expect(authors.locator('.study-visual-description-body')).toContainText('Lucas: Médico e historiador detalhista.');
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await expect(chartImage).toHaveAttribute('src', /p003-books-dark\.svg$/);
  await expect(authors.locator('.study-visual-preview img')).toHaveAttribute('src', /p004-authors-dark\.svg$/);
  await expectLoaded(chartImage);
  await chart.screenshot({ path: testInfo.outputPath('intro-chart-dark.png') });
  const enlarge = chart.getByRole('button', { name: 'Ampliar imagem: Total de livros por testamento', exact: true });
  await enlarge.click();
  const modal = page.getByRole('dialog', { name: 'Total de livros por testamento', exact: true });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Aumentar ampliação', exact: true }).click();
  await modal.getByRole('button', { name: 'Aumentar ampliação', exact: true }).click();
  await expect(modal.getByLabel('Nível de ampliação', { exact: true })).toHaveText('200%');
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await expect(enlarge).toBeFocused();
  expect(errors).toEqual([]);
});

test('o áudio usa as relações verificadas do quadro, sem narrar o texto fragmentado antigo', async ({ page }) => {
  await captureSpeech(page);
  await page.goto('/');
  await studies(page);
  await openLesson(page, 'Conhecendo a Bíblia');
  await page.getByRole('button', { name: 'Ouvir texto da página 4', exact: true }).click();
  const speech = () => page.evaluate(() => (window as unknown as { __studySpoken: string[] }).__studySpoken.join(' '));
  await expect.poll(speech).toContain('Moisés: Legislador e libertador do povo hebreu.');
  await expect.poll(speech).toContain('Lucas: Médico e historiador detalhista.');
  await expect.poll(speech).toContain('Cada um, em seu contexto, foi movido pelo Espírito Santo');
  expect(await speech()).not.toMatch(/Legislador e libertador do povo hebreu\.\s+Moisés\s+Davi/);
  await page.evaluate(() => { (window as unknown as { __studySpoken: string[] }).__studySpoken.length = 0; });
  await page.getByRole('button', { name: 'Ouvir tela', exact: true }).click();
  await expect.poll(speech).toContain('Antigo Testamento: 39 livros.');
  await expect.poll(speech).toContain('Lucas: Médico e historiador detalhista.');
  expect(await speech()).not.toMatch(/Antigo Testamento\s+39\s+Novo Testamento\s+27/);
});

test('texto comum e figuras pontuais permanecem separados no celular', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await studies(page);
  await openLesson(page, 'Gênesis: o começo da jornada');
  const introduction = page.locator('.study-text-section').filter({ has: page.getByRole('heading', { name: 'Página 2', exact: true }) });
  await expect(introduction.locator('figure.study-visual')).toHaveCount(0);
  const prose = introduction.locator('.study-section-body p').filter({ hasText: 'O Antigo Testamento constitui a primeira grande parte' }).first();
  await expect(prose).toBeVisible();
  const fontBefore = await prose.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
  await page.getByRole('button', { name: 'Acessibilidade', exact: true }).click();
  await page.getByRole('button', { name: 'Aumentar letra', exact: true }).click();
  await expect.poll(() => prose.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBe(fontBefore + 2);
  await page.getByRole('button', { name: 'Fechar preferências', exact: true }).click();
  await introduction.screenshot({ path: testInfo.outputPath('native-prose-mobile.png') });
  const firstFigure = page.locator('figure.study-visual').first();
  await expectLoaded(firstFigure.locator('.study-visual-preview img'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-study-page.png') });
  await firstFigure.locator('xpath=ancestor::section[contains(@class, "study-text-section")][1]').screenshot({ path: testInfo.outputPath('mobile-native-text-and-figure.png') });
  await firstFigure.getByRole('button', { name: /^Ampliar imagem:/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Voltar aos estudos', exact: true }).click();
  await openLesson(page, 'Mateus em um quadro');
  await expect(page.getByRole('heading', { name: 'Página em conferência', exact: true })).toBeVisible();
  const reviewedFigures = page.locator('figure.study-visual .study-visual-preview img');
  if (await reviewedFigures.count()) await expectLoaded(reviewedFigures.first());
  await expect(page.getByText(/A transcrição desta página ainda precisa de conferência/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ouvir texto da página 1', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});


test('os parágrafos ao redor dos quadros continuam selecionáveis e disponíveis em áudio', async ({ page }, testInfo) => {
  await captureSpeech(page);
  await page.goto('/');
  await studies(page);
  await openLesson(page, 'Gênesis: o começo da jornada');
  const genesis = page.locator('.study-text-section').filter({ has: page.getByRole('heading', { name: 'Página 3', exact: true }) });
  await expect(genesis.locator('figure.study-visual')).not.toHaveCount(0);
  const genesisText = genesis.locator('.study-section-body');
  await expect(genesisText.filter({ hasText: /autoria de Gênesis/ }).first()).toBeVisible();
  expect(await genesisText.allTextContents()).not.toEqual([]);
  const header = genesis.locator('figure.study-visual');
  await header.getByText('Ler descrição da imagem', { exact: true }).click();
  await header.getByRole('button', { name: 'Ouvir descrição: Informações e cronologia do livro', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __studySpoken: string[] }).__studySpoken.join(' '))).toContain('Capítulos: 50');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __studySpoken: string[] }).__studySpoken.join(' '))).toContain('Versículos: 1533');
  await genesis.screenshot({ path: testInfo.outputPath('native-text-and-header.png') });
  await page.getByRole('button', { name: 'Voltar aos estudos', exact: true }).click();
  await openLesson(page, 'Êxodo');
  const exodus = page.locator('.study-text-section').filter({ has: page.getByRole('heading', { name: 'Página 14', exact: true }) });
  await expect(exodus.locator('figure.study-visual')).not.toHaveCount(0);
  await expect(exodus.locator('.study-section-body').filter({ hasText: /tradição judaico-cristã/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Ouvir texto da página 14', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __studySpoken: string[] }).__studySpoken.join(' '))).toContain('tradição judaico-cristã');
  const images = await exodus.locator('figure.study-visual img').evaluateAll(elements => elements.map(element => (element as HTMLImageElement).getAttribute('src')));
  expect(images.every(source => !/\/p\d{3}\.webp$/.test(source || ''))).toBe(true);
  const recreatedTable = exodus.locator('figure.study-visual-table').first();
  await expectLoaded(recreatedTable.locator('.study-visual-preview img'));
  await recreatedTable.screenshot({ path: testInfo.outputPath('recreated-table.png') });
  const tabernacle = page.locator('figure.study-visual').filter({ has: page.getByRole('heading', { name: 'Planta do Tabernáculo', exact: true }) });
  await expectLoaded(tabernacle.locator('.study-visual-preview img'));
  await expect(tabernacle.locator('.study-visual-preview img')).toHaveAttribute('src', /p020-tabernacle-light\.png$/);
  await tabernacle.screenshot({ path: testInfo.outputPath('generated-tabernacle.png') });
});

test('figuras ainda em conferência usam recortes originais ampliáveis sem inventar leitura em áudio', async ({ page }, testInfo) => {
  await page.goto('/');
  await studies(page);
  await openLesson(page, 'Como a Bíblia está organizada');
  const section = page.locator('.study-text-section').filter({ has: page.locator('.study-section-topline').getByText('Página 8', { exact: true }) });
  await expect(section.getByRole('heading', { name: 'Página em conferência', exact: true })).toBeVisible();
  const figure = section.locator('figure.study-visual');
  const original = figure.locator('.study-visual-preview img');
  await expectLoaded(original);
  await expect(original).toHaveAttribute('src', /p008-division-rings-original\.png$/);
  await expect(original).toHaveAttribute('alt', /Imagem original do PDF/);
  await expect(figure).toContainText('Imagem original do PDF.');
  await expect(figure.getByRole('button', { name: /^Ouvir descrição:/ })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Ouvir texto da página 8', exact: true })).toHaveCount(0);
  await expect(section.locator('.study-source-link')).toHaveAttribute('href', '/api/sources/study-1#page=8');
  await figure.screenshot({ path: testInfo.outputPath('original-division-figure.png') });
  const source = await original.getAttribute('src');
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await expect(original).toHaveAttribute('src', source!);
  const enlarge = figure.getByRole('button', { name: 'Ampliar imagem: Como a Bíblia é dividida', exact: true });
  await enlarge.click();
  const dialog = page.getByRole('dialog', { name: 'Como a Bíblia é dividida', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Aumentar ampliação', exact: true }).click();
  await expect(dialog.getByLabel('Nível de ampliação', { exact: true })).toHaveText('150%');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(enlarge).toBeFocused();

  await page.getByRole('button', { name: 'Voltar aos estudos', exact: true }).click();
  await openLesson(page, 'João em um quadro');
  await page.setViewportSize({ width: 390, height: 844 });
  const gospelOriginals = page.locator('figure.study-visual').filter({ has: page.locator('img[src$="-original.png"]') });
  await expect(gospelOriginals).toHaveCount(2);
  for (const image of await gospelOriginals.locator('.study-visual-preview img').all()) {
    await expectLoaded(image);
    await expect(image).toHaveAttribute('src', /\/gospels\/p004-(?:book-info|timeline)-original\.png$/);
  }
  await expect(page.getByRole('button', { name: 'Ouvir texto da página 4', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await gospelOriginals.first().screenshot({ path: testInfo.outputPath('original-gospel-mobile.png') });
});
