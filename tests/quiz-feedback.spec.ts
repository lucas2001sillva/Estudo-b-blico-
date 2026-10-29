import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Catalog, Question, Studies } from '../src/types';

async function captureSpeech(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    Object.defineProperty(window, '__quizSpoken', { value: spoken });
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

async function expectExplanation(container: Locator, question: Question, studies: Studies) {
  const title = studies.sources.find(source => source.id === question.source.sourceId)?.title;
  expect(title).toBeTruthy();
  await expect(container.locator('.quiz-explanation')).toContainText(`Resumo do material: ${question.explanation}`);
  await expect(container.locator('.study-source-link')).toContainText(`${title} · p. ${question.source.page}`);
  await expect(container.locator('.study-source-link')).toHaveAttribute('href', `/api/sources/${question.source.sourceId}#page=${question.source.page}`);
}

test('quiz explica acerto e erro com resumo, áudio e fonte correta na resposta, resultado e histórico', async ({ page }, testInfo) => {
  await captureSpeech(page);
  await page.goto('/#quiz');
  const { studies }: Catalog = await (await page.request.get('/api/catalog')).json();
  const quiz = studies.quizzes.find(item => item.questions.length >= 2 && item.questions[0].source.page !== item.questions[1].source.page);
  expect(quiz).toBeTruthy();
  if (!quiz) return;
  await page.locator('.quiz-catalog-card').filter({ has: page.getByRole('heading', { name: quiz.title, exact: true }) }).click();

  for (const [index, question] of quiz.questions.entries()) {
    await expect(page.getByRole('heading', { level: 1, name: question.prompt, exact: true })).toBeVisible();
    await expect(page.locator('.quiz-feedback')).toHaveCount(0);
    await expect(page.locator('.quiz-explanation')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ouvir explicação da resposta', exact: true })).toHaveCount(0);
    const choice = index === 0 ? (question.answerIndex + 1) % question.choices.length : question.answerIndex;
    const radio = page.getByRole('radio', { name: question.choices[choice], exact: true });
    await page.locator('.quiz-choice').filter({ has: radio }).click();
    await expect(radio).toBeChecked();
    await page.getByRole('button', { name: 'Confirmar resposta', exact: true }).click();
    const feedback = page.locator('.quiz-feedback');
    await expect(feedback).toHaveClass(index === 0 ? /is-incorrect/ : /is-correct/);
    await expect(feedback).toContainText(`Resposta correta: ${question.choices[question.answerIndex]}`);
    await expectExplanation(feedback, question, studies);
    await page.evaluate(() => { (window as unknown as { __quizSpoken: string[] }).__quizSpoken.length = 0; });
    await feedback.getByRole('button', { name: 'Ouvir explicação da resposta', exact: true }).click();
    const speech = () => page.evaluate(() => (window as unknown as { __quizSpoken: string[] }).__quizSpoken.join('').replace(/\s+/g, ' ').trim());
    await expect.poll(speech).toContain(`Resposta correta: ${question.choices[question.answerIndex]}`);
    await expect.poll(speech).toContain(question.explanation.replace(/\s+/g, ' ').trim());
    const title = studies.sources.find(source => source.id === question.source.sourceId)!.title;
    await expect.poll(speech).toContain(`Fonte: ${title}, página ${question.source.page}`);
    if (index === 0) await feedback.screenshot({ path: testInfo.outputPath('quiz-summary-and-source.png') });
    await page.getByRole('button', { name: index === quiz.questions.length - 1 ? 'Ver resultado' : 'Próxima pergunta', exact: true }).click();
  }

  await expect(page.locator('.quiz-score')).toHaveText(new RegExp(`${quiz.questions.length - 1}\\s*/\\s*${quiz.questions.length}`));
  const review = page.locator('.quiz-result-review .quiz-review-item');
  await expect(review).toHaveCount(quiz.questions.length);
  for (const [index, question] of quiz.questions.entries()) await expectExplanation(review.nth(index), question, studies);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: quiz.questions[0].prompt, exact: true })).toBeVisible();
  await expect(page.locator('.quiz-feedback')).toHaveCount(0);
  await expect(page.locator('.quiz-explanation')).toHaveCount(0);

  await page.getByRole('button', { name: 'Todos os quizzes', exact: true }).click();
  const catalogItem = page.locator('.quiz-catalog-item').filter({ has: page.getByRole('heading', { name: quiz.title, exact: true }) });
  await catalogItem.locator('.quiz-attempt-history > summary').click();
  await expect(catalogItem.locator('.quiz-history-attempt')).toHaveCount(1);
  await catalogItem.locator('.quiz-history-attempt > summary').click();
  const historyReview = catalogItem.locator('.quiz-history-attempt .quiz-review-item');
  await expect(historyReview).toHaveCount(quiz.questions.length);
  for (const [index, question] of quiz.questions.entries()) await expectExplanation(historyReview.nth(index), question, studies);
});
