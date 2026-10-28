import { expect, test, type Page } from '@playwright/test';
import type { Passage } from '../src/types';

const storageKey = 'vereda:featured-passage';
const reference = (passage: Passage) => `${passage.bookName} ${passage.chapter}:${passage.verseStart}${passage.verseEnd !== passage.verseStart ? `–${passage.verseEnd}` : ''}`;

async function begin(page: Page, id: string) {
  await page.addInitScript(({ key, initial }) => {
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, initial);
  }, { key: storageKey, initial: id });
  await page.goto('/');
  await expect(page.locator('.daily-passage blockquote')).toBeVisible();
  return (await (await page.request.get('/api/catalog')).json()).passages as Passage[];
}

async function expectPassage(page: Page, passage: Passage) {
  const card = page.getByRole('region', { name: 'Passagem bíblica em destaque', exact: true });
  await expect(card.locator('blockquote')).toHaveText(passage.text);
  await expect(card.getByRole('button', { name: reference(passage), exact: true })).toBeVisible();
  await expect(card.locator('.passage-source')).toHaveAttribute('href', `/api/sources/${passage.source.sourceId}#page=${passage.source.pages[0]}`);
  await expect(card.locator('.passage-source')).toContainText(`Bíblia ${passage.version}`);
  await expect(card.locator('.passage-source')).toContainText(passage.source.pages.join(', '));
}

test('as 50 trocas mantêm texto, referência e PDF juntos, incluindo retorno e cliques rápidos', async ({ page }) => {
  const passages = await begin(page, 'passagem-50');
  for (let step = 0; step < passages.length; step++) {
    await expectPassage(page, passages[(49 + step) % 50]);
    await page.getByRole('button', { name: 'Próxima passagem', exact: true }).click();
  }
  await expectPassage(page, passages[49]);
  await page.getByRole('button', { name: 'Passagem anterior', exact: true }).click();
  await expectPassage(page, passages[48]);
  await page.getByRole('button', { name: 'Próxima passagem', exact: true }).evaluate(button => {
    for (let count = 0; count < 101; count++) (button as HTMLButtonElement).click();
  });
  await expectPassage(page, passages[49]);
});

test('abrir a referência usa a página do versículo e voltar ou recarregar preserva a passagem', async ({ page }) => {
  const passages = await begin(page, 'passagem-20');
  const selected = passages[19];
  await expectPassage(page, selected);
  await page.getByRole('button', { name: reference(selected), exact: true }).click();
  await expect(page.locator('#verse-105')).toContainText(selected.text);
  await expect(page.locator('#verse-105')).toHaveClass(/highlighted-verse/);
  await expect(page.locator('.scripture .source-link')).toHaveAttribute('href', '/api/sources/at#page=623');
  await page.getByRole('link', { name: 'Início', exact: true }).filter({ visible: true }).first().click();
  await expectPassage(page, selected);
  await page.getByRole('button', { name: 'Próxima passagem', exact: true }).click();
  await page.reload();
  await expectPassage(page, passages[20]);
  await page.evaluate(key => sessionStorage.setItem(key, 'passagem-39'), storageKey);
  await page.reload();
  await expectPassage(page, passages[38]);
  await page.getByRole('button', { name: 'João 3:16', exact: true }).click();
  await expect(page.locator('#verse-16')).toContainText(passages[38].text);
  await expect(page.locator('.scripture .source-link')).toHaveAttribute('href', '/api/sources/nt#page=98');
});

test('trocar de passagem interrompe a voz anterior e o novo áudio identifica livro e versão', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { spoken: [] as string[], canceled: 0 };
    Object.defineProperty(window, '__passageSpeech', { value: state });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { getVoices() { return []; }, paused: false, cancel() { state.canceled++; }, pause() {}, resume() {},
        speak(utterance: SpeechSynthesisUtterance) {
          state.spoken.push(utterance.text);
          if (state.spoken.length > 1) setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 0);
        } },
    });
  });
  const passages = await begin(page, 'passagem-01');
  await page.getByRole('button', { name: 'Ouvir passagem em destaque', exact: true }).click();
  const speech = () => page.evaluate(() => (window as unknown as { __passageSpeech: { spoken: string[]; canceled: number } }).__passageSpeech);
  await expect.poll(async () => (await speech()).spoken.join(' ')).toContain('Gênesis 1:1');
  const canceled = (await speech()).canceled;
  await page.getByRole('button', { name: 'Próxima passagem', exact: true }).click();
  await expect.poll(async () => (await speech()).canceled).toBeGreaterThan(canceled);
  await expectPassage(page, passages[1]);
  await page.getByRole('button', { name: 'Ouvir passagem em destaque', exact: true }).click();
  await expect.poll(async () => (await speech()).spoken.join(' ')).toContain('Gênesis 1:27');
  await expect.poll(async () => (await speech()).spoken.join(' ')).toContain('Bíblia NVI');
});
