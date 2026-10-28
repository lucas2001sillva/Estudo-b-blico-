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

test('imagens de páginas compostas e em conferência abrem no celular sem romper o layout', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await studies(page);
  await openLesson(page, 'Gênesis: o começo da jornada');
  const firstComposite = page.locator('figure.study-visual').first();
  await expectLoaded(firstComposite.locator('.study-visual-preview img'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-study-page.png') });
  await firstComposite.getByRole('button', { name: /^Ampliar imagem:/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Voltar aos estudos', exact: true }).click();
  await openLesson(page, 'Mateus em um quadro');
  await expect(page.getByRole('heading', { name: 'Página em conferência', exact: true })).toBeVisible();
  await expectLoaded(page.locator('figure.study-visual .study-visual-preview img').first());
  await expect(page.getByText(/A transcrição desta página ainda precisa de conferência/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ouvir texto da página 1', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
