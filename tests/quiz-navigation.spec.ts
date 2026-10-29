import { expect, test, type Page } from '@playwright/test';
import type { Catalog } from '../src/types';

async function expectNearTop(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.top >= 0 && box.top < 140 && box.bottom < window.innerHeight - 75;
  })).toBe(true);
}

test('no celular, escolher trilha ou nível revela os quizzes e permite voltar aos filtros', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#quiz');
  const data: Catalog = await (await page.request.get('/api/catalog')).json();
  const trail = data.studies.trails.find(item => data.studies.quizzes.some(quiz => data.studies.lessons.find(lesson => lesson.id === quiz.lessonId)?.trailId === item.id))!;
  await page.getByRole('combobox', { name: 'Trilha', exact: true }).selectOption(trail.id);
  const heading = page.locator('.quiz-results-heading');
  await expect(heading).toContainText(trail.title);
  await expect(heading).toBeFocused();
  await expectNearTop(page, '.quiz-results-heading');
  await expect(page.getByRole('button', { name: 'Ver filtros', exact: true })).toBeInViewport({ ratio: 1 });
  expect((await page.locator('.quiz-catalog-card').first().boundingBox())!.y).toBeLessThan(700);
  await page.screenshot({ path: testInfo.outputPath('mobile-trail-results-revealed.png') });

  await page.getByRole('button', { name: 'Ver filtros', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Trilha', exact: true })).toBeFocused();
  await expectNearTop(page, '.quiz-category-choices');
  await expect(page.getByRole('combobox', { name: 'Trilha', exact: true })).toBeInViewport({ ratio: 1 });
  const search = page.getByRole('searchbox', { name: 'Buscar quiz por assunto', exact: true });
  await search.fill('Bíblia');
  await expect(search).toBeFocused();
  await search.fill('');

  await page.locator('.quiz-category-choice').filter({ has: page.getByText('Bíblia', { exact: true }) }).click();
  await expect(heading).toBeFocused();
  await expectNearTop(page, '.quiz-results-heading');
  await page.getByRole('button', { name: 'Ver filtros', exact: true }).click();
  await page.getByRole('combobox', { name: 'Nível de dificuldade', exact: true }).selectOption('hard');
  await expect(heading).toContainText('Difícil');
  await expect(heading).toBeFocused();
  await expectNearTop(page, '.quiz-results-heading');
  await expect(page.locator('.quiz-catalog-card')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-difficulty-results-revealed.png') });
  await page.locator('.quiz-catalog-card').first().click();
  await expect(page.locator('.quiz-question-title h1')).toBeFocused();
  await page.getByRole('button', { name: 'Todos os quizzes', exact: true }).click();
  await expect(heading).toContainText('Difícil');
  await expect(heading).toBeFocused();
  await expectNearTop(page, '.quiz-results-heading');
});

test('as trilhas dos estudos também levam à biblioteca escolhida sem perder o caminho de volta', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#estudos');
  const card = page.locator('.study-trail-card').last();
  const title = await card.locator('h3').innerText();
  await card.click();
  await expect(page.locator('#study-library-heading')).toHaveText(title);
  await expect(page.locator('#study-library-heading')).toBeFocused();
  await expectNearTop(page, '#study-library-heading');
  await page.screenshot({ path: testInfo.outputPath('mobile-study-trail-revealed.png') });
  await page.getByRole('button', { name: 'Trocar trilha', exact: true }).click();
  await expect(page.locator('#study-trails-heading')).toBeFocused();
  await expectNearTop(page, '#study-trails-heading');
});
