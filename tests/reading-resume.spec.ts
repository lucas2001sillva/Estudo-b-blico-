import { expect, test, type Page } from '@playwright/test';
import type { Chapter } from '../src/types';

const password = 'Leitura-retomada-2026!';
const position = (verse: number) => ({ bookId: 'joao', chapter: 3, verse });
const reference = (verse: number) => `biblia?livro=joao&capitulo=3&versiculo=${verse}`;

async function navigate(page: Page, name: string) {
  await page.getByRole('link', { name, exact: true }).filter({ visible: true }).first().click();
}

async function selectVerse(page: Page, verse: number) {
  await page.evaluate(hash => { window.location.hash = hash; }, reference(verse));
  await expect(page.locator(`#verse-${verse}`)).toHaveClass(/highlighted-verse/);
}

async function expectSourceForVerse(page: Page, verse: number) {
  const { chapter }: { chapter: Chapter } = await (await page.request.get('/api/bible/joao/3')).json();
  const pdfPage = chapter.verses.find(item => item.number === verse)?.sourcePages?.[0] ?? chapter.sourcePages[0];
  await expect(page.locator('.scripture .source-link')).toHaveAttribute('href', `/api/sources/nt#page=${pdfPage}`);
}

test('o visitante salva mudanças de versículo no mesmo capítulo e retoma após recarregar', async ({ page }) => {
  let chapterRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/bible/joao/3') chapterRequests++; });
  await page.goto(`/#${reference(16)}`);
  await expect(page.locator('#verse-16')).toHaveClass(/highlighted-verse/);
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('vereda.guest.v1') || '{}').state?.lastReading);
  await expect.poll(saved).toEqual(position(16));
  await selectVerse(page, 17);
  await expect.poll(saved).toEqual(position(17));
  expect(chapterRequests).toBe(1);
  await expectSourceForVerse(page, 17);

  await navigate(page, 'Início');
  await page.reload();
  await navigate(page, 'Bíblia');
  await expect(page.locator('#verse-17')).toHaveClass(/highlighted-verse/);
  await expect.poll(saved).toEqual(position(17));
  await expectSourceForVerse(page, 17);
});

test('uma resposta atrasada do capítulo salva o versículo atual, sem repetir a requisição', async ({ page }) => {
  let release = () => {};
  const ready = new Promise<void>(resolve => { release = resolve; });
  let captured = false;
  let requests = 0;
  await page.route('**/api/bible/joao/3', async route => {
    requests++;
    const response = await route.fetch();
    captured = true;
    await ready;
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/#${reference(16)}`);
    await expect.poll(() => captured).toBe(true);
    await page.evaluate(hash => { window.location.hash = hash; }, reference(17));
    release();
    await expect(page.locator('#verse-17')).toHaveClass(/highlighted-verse/);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vereda.guest.v1') || '{}').state?.lastReading)).toEqual(position(17));
    expect(requests).toBe(1);
  } finally {
    release();
    await page.unroute('**/api/bible/joao/3');
  }
});

test('a conta sincroniza o versículo selecionado e outro dispositivo retoma a mesma posição', async ({ page, browser, baseURL }) => {
  const email = `retomada-${crypto.randomUUID()}@example.test`;
  const registration = await page.request.post('/api/auth/register', { data: { name: 'Leitor de retomada', email, password } });
  expect(registration.status()).toBe(201);
  await page.goto(`/#${reference(16)}`);
  await expect(page.getByRole('button', { name: 'Sair da conta', exact: true })).toBeVisible();
  await expect(page.locator('#verse-16')).toHaveClass(/highlighted-verse/);
  const saved = async () => (await (await page.request.get('/api/state')).json()).state.lastReading;
  await expect.poll(saved).toEqual(position(16));
  await selectVerse(page, 17);
  await expect.poll(saved).toEqual(position(17));

  const otherDevice = await browser.newContext({ baseURL });
  try {
    expect((await otherDevice.request.post('/api/auth/login', { data: { email, password } })).ok()).toBe(true);
    const otherPage = await otherDevice.newPage();
    await otherPage.goto('/#biblia');
    await expect(otherPage.getByRole('button', { name: 'Sair da conta', exact: true })).toBeVisible();
    await expect(otherPage.locator('#verse-17')).toHaveClass(/highlighted-verse/);
    await expectSourceForVerse(otherPage, 17);
    await otherPage.reload();
    await expect(otherPage.locator('#verse-17')).toHaveClass(/highlighted-verse/);
    expect((await (await otherDevice.request.get('/api/state')).json()).state.lastReading).toEqual(position(17));
  } finally {
    await otherDevice.close();
  }
});

test('a sessão atrasada mantém o salvamento desabilitado até confirmar a conta, sem gravar leituras como visitante', async ({ page }) => {
  const registration = await page.request.post('/api/auth/register', { data: { name: 'Leitora com sessão atrasada', email: `sessao-${crypto.randomUUID()}@example.test`, password } });
  expect(registration.status()).toBe(201);
  let release = () => {};
  const ready = new Promise<void>(resolve => { release = resolve; });
  let captured = false;
  let writes = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/state' && request.method() === 'PATCH') writes++; });
  await page.route('**/api/session', async route => {
    const response = await route.fetch();
    captured = true;
    await ready;
    await route.fulfill({ response });
  });
  const guest = () => page.evaluate(() => JSON.parse(localStorage.getItem('vereda.guest.v1') || '{}').state);
  try {
    await page.goto(`/#${reference(16)}`);
    await expect.poll(() => captured).toBe(true);
    await expect(page.locator('#verse-16')).toHaveClass(/highlighted-verse/);
    const complete = page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true });
    await expect(complete).toBeDisabled();
    expect(writes).toBe(0);
    expect((await guest())?.lastReading ?? null).toBeNull();
    expect(Object.values((await guest())?.completedChapters ?? {})).not.toContain(true);

    release();
    await expect(page.locator('.account-chip')).toContainText('Leitora com sessão atrasada');
    await expect(complete).toBeEnabled();
    await complete.click();
    await expect.poll(async () => {
      const { state } = await (await page.request.get('/api/state')).json();
      return { reading: state.lastReading, completed: state.completedChapters['joao:3'] };
    }).toEqual({ reading: position(16), completed: true });
    expect((await guest())?.lastReading ?? null).toBeNull();
    expect(Object.values((await guest())?.completedChapters ?? {})).not.toContain(true);
  } finally {
    release();
    await page.unroute('**/api/session');
  }
});


test('o celular permite encerrar a sessão pela página de progresso sem perder a leitura salva', async ({ page }) => {
  const registration = await page.request.post('/api/auth/register', { data: { name: 'Leitor no celular', email: `celular-${crypto.randomUUID()}@example.test`, password } });
  expect(registration.status()).toBe(201);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#biblia?livro=joao&capitulo=3&versiculo=17');
  await page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).state.completedChapters['joao:3']).toBe(true);
  await page.getByRole('link', { name: 'Progresso', exact: true }).click();
  const logout = page.getByRole('button', { name: 'Sair da minha conta', exact: true });
  await expect(logout).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await logout.click();
  await expect(page.getByRole('button', { name: 'Entrar na conta', exact: true })).toBeVisible();
  expect((await page.request.get('/api/state')).status()).toBe(401);
});
