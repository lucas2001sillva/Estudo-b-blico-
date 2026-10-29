import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Catalog, ProgressState, Question, Quiz, QuizAttempt } from '../src/types';

async function catalog(page: Page): Promise<Catalog> {
  return (await page.request.get('/api/catalog')).json();
}

async function category(page: Page, name: 'Bíblia' | 'Estudos dos PDFs') {
  const button = page.getByRole('group', { name: 'Escolher conteúdo do quiz', exact: true })
    .getByRole('button').filter({ has: page.getByText(name, { exact: true }) });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

function quizCard(page: Page, quiz: Quiz) {
  return page.locator('.quiz-catalog-card').filter({ has: page.getByRole('heading', { name: quiz.title, exact: true }) });
}

async function navigate(page: Page, name: string) {
  await page.getByRole('link', { name, exact: true }).filter({ visible: true }).first().click();
}

async function chooseAnswer(page: Page, question: Question, correct = true) {
  await expect(page.getByRole('heading', { level: 1, name: question.prompt, exact: true })).toBeVisible();
  const index = correct ? question.answerIndex : (question.answerIndex + 1) % question.choices.length;
  const radio = page.getByRole('radio', { name: question.choices[index], exact: true });
  await page.locator('.quiz-choice').filter({ has: radio }).click();
  await expect(radio).toBeChecked();
  await page.getByRole('button', { name: 'Confirmar resposta', exact: true }).click();
  await expect(page.locator('.quiz-feedback')).toHaveClass(correct ? /is-correct/ : /is-incorrect/);
}

async function captureSpeech(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    Object.defineProperty(window, '__catalogSpoken', { value: spoken });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      cancel() {}, pause() {}, resume() {}, getVoices() { return []; }, paused: false,
      speak(utterance: SpeechSynthesisUtterance) {
        spoken.push(utterance.text);
        window.setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 0);
      },
    } });
  });
}

function reference(question: Question) {
  const source = question.source;
  return `${source.bookName} ${source.chapter}:${source.verseStart}${source.verseEnd && source.verseEnd !== source.verseStart ? `–${source.verseEnd}` : ''}`;
}

async function expectBibleSource(container: Locator, question: Question) {
  const source = question.source;
  const title = source.sourceId === 'at' ? 'Bíblia NVI — Antigo Testamento' : 'Bíblia NVI — Novo Testamento';
  await expect(container.locator('.quiz-explanation')).toContainText(`Resumo da passagem: ${question.explanation}`);
  await expect(container.locator('.quiz-bible-reference')).toContainText(`Ler ${reference(question)} na Bíblia`);
  await expect(container.locator('.quiz-bible-reference')).toHaveAttribute('href', `#biblia?livro=${encodeURIComponent(source.bookId!)}&capitulo=${source.chapter}&versiculo=${source.verseStart}`);
  const pages = source.pages ?? [source.page];
  await expect(container.locator('.study-source-link')).toContainText(`${title} · ${pages.length > 1 ? 'pp.' : 'p.'} ${pages.join(', ')}`);
  await expect(container.locator('.study-source-link')).toHaveAttribute('href', `/api/sources/${source.sourceId}#page=${source.page}`);
  for (const page of pages.slice(1)) await expect(container.getByRole('link', { name: `Ir à página ${page}`, exact: false })).toHaveAttribute('href', `/api/sources/${source.sourceId}#page=${page}`);
}

test('passagens que atravessam páginas mostram todos os links e narram a fonte completa', async ({ page }, testInfo) => {
  await captureSpeech(page);
  await page.goto('/#quiz');
  const data = await catalog(page);
  const quiz = data.bibleQuizzes!.find(item => item.questions.some(question => question.source.sourceId === 'nt' && (question.source.pages?.length ?? 0) > 1))!;
  await category(page, 'Bíblia');
  await quizCard(page, quiz).click();
  for (const question of quiz.questions) {
    await chooseAnswer(page, question);
    if ((question.source.pages?.length ?? 0) > 1) {
      const feedback = page.locator('.quiz-feedback');
      await expectBibleSource(feedback, question);
      await feedback.getByRole('button', { name: 'Ouvir explicação da resposta', exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __catalogSpoken: string[] }).__catalogSpoken.join(' '))).toContain(`páginas ${question.source.pages!.join(' e ')}`);
      await feedback.screenshot({ path: testInfo.outputPath('multi-page-source-links.png') });
      return;
    }
    await page.getByRole('button', { name: 'Próxima pergunta', exact: true }).click();
  }
  throw new Error('Deve haver uma passagem que atravessa páginas para conferir a referência completa.');
});

test('a biblioteca separa Bíblia e estudos e filtra quarenta perguntas por dificuldade', async ({ page }, testInfo) => {
  await page.goto('/#quiz');
  const data = await catalog(page);
  expect(data.bibleQuizzes).toHaveLength(12);
  expect(data.studies.quizzes).toHaveLength(14);
  await expect(page.locator('.quiz-catalog-card')).toHaveCount(14);
  await expect(page.locator('.quiz-category-choice').filter({ has: page.getByText('Bíblia', { exact: true }) })).toContainText('120 perguntas');
  await expect(page.locator('.quiz-category-choice').filter({ has: page.getByText('Estudos dos PDFs', { exact: true }) })).toContainText('112 perguntas');
  await category(page, 'Bíblia');
  await expect(page.locator('.quiz-catalog-card')).toHaveCount(12);
  for (const [value, label] of [['easy', 'Fácil'], ['medium', 'Médio'], ['hard', 'Difícil']]) {
    await page.getByRole('combobox', { name: 'Nível de dificuldade', exact: true }).selectOption(value);
    await expect(page.locator('.quiz-catalog-card')).toHaveCount(4);
    await expect(page.locator('.study-result-count')).toContainText('4 quizzes disponíveis · 40 perguntas');
    await expect(page.locator('.quiz-catalog-card .quiz-difficulty')).toHaveText([label, label, label, label]);
  }
  await page.screenshot({ path: testInfo.outputPath('bible-difficulty-catalog.png'), fullPage: true });
  await category(page, 'Estudos dos PDFs');
  await expect(page.locator('.quiz-catalog-card')).toHaveCount(14);
  await expect(page.getByRole('combobox', { name: 'Nível de dificuldade', exact: true })).toHaveCount(0);
});

test('uma rodada bíblica explica respostas com referências e salva dez respostas com revisão', async ({ page }, testInfo) => {
  await captureSpeech(page);
  await page.goto('/#quiz');
  const data = await catalog(page);
  const quiz = data.bibleQuizzes?.find(item => item.difficulty === 'medium');
  expect(quiz).toBeTruthy();
  if (!quiz) throw new Error('O catálogo deve conter uma rodada bíblica de nível médio.');
  expect(quiz.questions).toHaveLength(10);
  await category(page, 'Bíblia');
  await quizCard(page, quiz).click();
  for (const [index, question] of quiz.questions.entries()) {
    await expect(page.locator('.quiz-feedback')).toHaveCount(0);
    await chooseAnswer(page, question, index !== 0);
    const feedback = page.locator('.quiz-feedback');
    await expectBibleSource(feedback, question);
    if (index < 2) {
      await page.evaluate(() => { (window as unknown as { __catalogSpoken: string[] }).__catalogSpoken.length = 0; });
      await feedback.getByRole('button', { name: 'Ouvir explicação da resposta', exact: true }).click();
      const spoken = () => page.evaluate(() => (window as unknown as { __catalogSpoken: string[] }).__catalogSpoken.join('').replace(/\s+/g, ' ').trim());
      await expect.poll(spoken).toContain(question.explanation.replace(/\s+/g, ' ').trim());
      await expect.poll(spoken).toContain(`Passagem: ${reference(question)}.`);
      await expect.poll(spoken).toContain(`página ${question.source.page}.`);
    }
    if (index === 0) await feedback.screenshot({ path: testInfo.outputPath('bible-quiz-explanation.png') });
    await page.getByRole('button', { name: index === quiz.questions.length - 1 ? 'Ver resultado' : 'Próxima pergunta', exact: true }).click();
  }
  await expect(page.locator('.quiz-score')).toHaveText(/9\s*\/\s*10/);
  await expect(page.locator('.quiz-result-review .quiz-review-item')).toHaveCount(10);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('vereda.guest.v1')!).state.quizAttempts as QuizAttempt[]);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ quizId: quiz.id, quizRevision: quiz.revision ?? 1, total: 10, score: 9 });
  expect(stored[0].answers).toHaveLength(10);
  await page.reload();
  await navigate(page, 'Meu progresso');
  await expect(page.locator('.attempt-list')).toContainText(quiz.title);
  await expect(page.locator('.attempt-list')).toContainText('9 / 10');
  await navigate(page, 'Quiz');
  await category(page, 'Bíblia');
  const item = page.locator('.quiz-catalog-item').filter({ has: page.getByRole('heading', { name: quiz.title, exact: true }) });
  await expect(item.locator('.quiz-best-score')).toContainText('Melhor resultado: 9 de 10');
  await item.locator('.quiz-attempt-history > summary').click();
  await item.locator('.quiz-history-attempt > summary').click();
  await expect(item.locator('.quiz-review-item')).toHaveCount(10);
  await expectBibleSource(item.locator('.quiz-review-item').first(), quiz.questions[0]);
});

test('quiz bíblico no celular mantém dificuldade, tema e fonte ajustável sem rolagem horizontal', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#quiz');
  const data = await catalog(page);
  const quiz = data.bibleQuizzes?.find(item => item.difficulty === 'hard');
  if (!quiz) throw new Error('O catálogo deve conter uma rodada bíblica difícil.');
  await category(page, 'Bíblia');
  await page.getByRole('combobox', { name: 'Nível de dificuldade', exact: true }).selectOption('hard');
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await quizCard(page, quiz).click();
  await expect(page.locator('.quiz-play-card > .quiz-difficulty')).toHaveText('Difícil');
  const text = page.locator('.quiz-choice-text').first();
  const before = await text.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
  await page.getByRole('button', { name: 'Acessibilidade', exact: true }).click();
  await page.getByRole('button', { name: 'Aumentar letra', exact: true }).click();
  await expect.poll(() => text.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBe(before + 2);
  await page.getByRole('button', { name: 'Fechar preferências', exact: true }).click();
  await chooseAnswer(page, quiz.questions[0]);
  await expectBibleSource(page.locator('.quiz-feedback'), quiz.questions[0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.locator('.quiz-feedback').screenshot({ path: testInfo.outputPath('mobile-bible-explanation-dark.png') });
});

test('ampliar o quiz preserva respostas antigas e registra uma nova tentativa sem reinterpretar o histórico', async ({ page }, testInfo) => {
  const data = await catalog(page);
  const quiz = data.studies.quizzes.find(item => item.previousVersions?.some(version => version.questions.length === 2));
  if (!quiz) throw new Error('Os quizzes ampliados precisam conservar a versão anterior.');
  const previous = quiz.previousVersions!.find(version => version.questions.length === 2)!;
  const oldAttempt: QuizAttempt = { id: 'legacy-browser-attempt', quizId: quiz.id, total: 2, score: 2,
    answers: previous.questions.map(question => question.answerIndex), createdAt: new Date(Date.now() - 86_400_000).toISOString() };
  const state: ProgressState = { completedChapters: {}, completedLessons: {}, quizAttempts: [oldAttempt],
    preferences: { theme: 'light', fontSize: 18, speechRate: 1 }, selectedTrailId: null, lastReading: null };
  await page.addInitScript(initial => {
    if (!sessionStorage.getItem('quiz-version-test-seeded')) {
      localStorage.setItem('vereda.guest.v1', JSON.stringify({ state: initial }));
      sessionStorage.setItem('quiz-version-test-seeded', '1');
    }
  }, state);
  await page.goto('/#quiz');
  const item = page.locator('.quiz-catalog-item').filter({ has: page.getByRole('heading', { name: quiz.title, exact: true }) });
  await expect(item.locator('.quiz-best-score')).not.toContainText('Melhor resultado');
  await expect(item.locator('.study-lesson-card-footer')).toHaveText('Começar quiz');
  await item.locator('.quiz-attempt-history > summary').click();
  await item.locator('.quiz-history-attempt > summary').click();
  await expect(item.locator('.quiz-version-note')).toContainText('Versão anterior');
  const oldReview = item.locator('.quiz-review-item');
  await expect(oldReview).toHaveCount(2);
  for (const [index, question] of previous.questions.entries()) {
    await expect(oldReview.nth(index).locator('h3')).toContainText(question.prompt);
    await expect(oldReview.nth(index)).toContainText(`Sua resposta: ${question.choices[question.answerIndex]}`);
  }
  await item.locator('.quiz-history-attempt').screenshot({ path: testInfo.outputPath('legacy-two-question-history.png') });
  await quizCard(page, quiz).click();
  expect(quiz.questions).toHaveLength(8);
  for (const [index, question] of quiz.questions.entries()) {
    await chooseAnswer(page, question);
    await page.getByRole('button', { name: index === quiz.questions.length - 1 ? 'Ver resultado' : 'Próxima pergunta', exact: true }).click();
  }
  await expect(page.locator('.quiz-score')).toHaveText(/8\s*\/\s*8/);
  await page.reload();
  const retained = await page.evaluate(() => JSON.parse(localStorage.getItem('vereda.guest.v1')!).state.quizAttempts as QuizAttempt[]);
  expect(retained).toHaveLength(2);
  expect(retained.find(attempt => attempt.id === oldAttempt.id)).toEqual(oldAttempt);
  expect(retained.find(attempt => attempt.id !== oldAttempt.id)).toMatchObject({ quizId: quiz.id, quizRevision: quiz.revision, total: 8, score: 8 });
  const updatedItem = page.locator('.quiz-catalog-item').filter({ has: page.getByRole('heading', { name: quiz.title, exact: true }) });
  await expect(updatedItem.locator('.quiz-best-score')).toContainText('Melhor resultado: 8 de 8');
  await updatedItem.locator('.quiz-attempt-history > summary').click();
  const histories = updatedItem.locator('.quiz-history-attempt');
  await expect(histories).toHaveCount(2);
  await histories.nth(1).locator('summary').click();
  await expect(histories.nth(1).locator('.quiz-review-item')).toHaveCount(2);
  await expect(histories.nth(1).locator('.quiz-version-note')).toContainText('Versão anterior');
});
