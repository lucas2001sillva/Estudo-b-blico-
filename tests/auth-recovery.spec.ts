import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Catalog } from '../src/types';

const password = 'Frase privada para testes 2026!';
const address = () => `recuperacao-${crypto.randomUUID()}@example.test`;
const importLabel = 'Adicionar minhas leituras deste navegador à conta';

async function bible(page: Page) {
  await page.getByRole('link', { name: 'Bíblia', exact: true }).filter({ visible: true }).first().click();
  await expect(page.getByRole('button', { name: /Marcar capítulo como lido|Desfazer leitura do capítulo/ })).toBeEnabled();
}

async function openAccess(page: Page) {
  await page.getByRole('button', { name: /^(Entrar na conta|Entrar ou criar conta)$/ }).filter({ visible: true }).first().click();
  return page.getByRole('dialog');
}

async function login(page: Page, email: string) {
  const dialog = await openAccess(page);
  await dialog.getByLabel('E-mail', { exact: true }).fill(email);
  await dialog.getByLabel('Senha', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Entrar na minha conta', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Sair da conta', exact: true })).toBeVisible();
}

async function accountState(page: Page) {
  const response = await page.request.get('/api/state');
  expect(response.ok()).toBe(true);
  return (await response.json()).state;
}

test('cadastro e login carregam o progresso mesmo sem uma segunda consulta e preservam a importação escolhida', async ({ page }) => {
  const email = address();
  let registrations = 0;
  page.on('request', request => {
    if (request.url().endsWith('/api/auth/register') && request.method() === 'POST') registrations++;
  });
  await page.goto('/');
  await bible(page);
  await page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true }).click();
  const dialog = await openAccess(page);
  await dialog.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await dialog.getByLabel('Nome', { exact: true }).fill('Leitora de recuperação');
  await dialog.getByLabel('E-mail', { exact: true }).fill(email);
  await dialog.getByLabel('Senha', { exact: true }).fill(password);
  await dialog.getByRole('checkbox', { name: importLabel, exact: true }).check();
  // A second GET used to make an already-created account look like a failed
  // registration. The authentication response must now include its own state.
  await page.route('**/api/state', async route => {
    if (route.request().method() === 'GET') await route.abort('failed');
    else await route.continue();
  });
  const registration = page.waitForResponse(response => response.url().endsWith('/api/auth/register') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Criar minha conta', exact: true }).click();
  const created = await registration;
  expect(created.status()).toBe(201);
  const payload = await created.json();
  expect(payload.state).toBeTruthy();
  expect(Number.isInteger(payload.revision)).toBe(true);
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.account-chip')).toContainText('Leitora de recuperação');
  await expect.poll(async () => (await accountState(page)).completedChapters['genesis:1']).toBe(true);
  await expect(page.locator('.sidebar-sync')).toHaveText('Sincronizado com sua conta');
  expect(registrations).toBe(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vereda.guest.v1') || '{}').state?.completedChapters)).toEqual({});
  await page.unroute('**/api/state');

  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await page.getByRole('button', { name: 'Acessibilidade', exact: true }).click();
  await page.getByRole('button', { name: 'Aumentar letra', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar preferências', exact: true }).click();
  await expect.poll(async () => (await accountState(page)).preferences).toMatchObject({ theme: 'dark', fontSize: 20 });
  await page.reload();
  await expect(page.locator('.account-chip')).toContainText('Leitora de recuperação');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar ou criar conta', exact: true })).toBeVisible();
  expect((await page.request.get('/api/state')).status()).toBe(401);

  await page.route('**/api/state', async route => {
    if (route.request().method() === 'GET') await route.abort('failed');
    else await route.continue();
  });
  await login(page, email);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('html').evaluate(element => element.style.getPropertyValue('--reader-size'))).toBe('20px');
  await bible(page);
  await expect(page.getByRole('button', { name: 'Desfazer leitura do capítulo', exact: true })).toBeVisible();
  expect(registrations).toBe(1);
  await page.unroute('**/api/state');
});

test('uma alteração recusada não bloqueia leituras válidas e pode ser recuperada somente na conta de origem', async ({ page }) => {
  const firstEmail = address();
  const first = await page.request.post('/api/auth/register', { data: { name: 'Conta de origem', email: firstEmail, password } });
  expect(first.status()).toBe(201);
  const { user } = await first.json();
  await page.goto('/');
  await expect(page.locator('.account-chip')).toContainText('Conta de origem');
  await bible(page);
  await expect(page.locator('.sidebar-sync')).toHaveText('Sincronizado com sua conta');
  await page.route('**/api/state', async route => {
    const request = route.request();
    if (request.method() === 'PATCH' && request.postDataJSON().completedChapters?.['genesis:1'] === true) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: 'null' });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true }).click();
  await expect(page.locator('.sidebar-sync')).toHaveText('Algumas alterações não foram salvas');
  await page.getByRole('button', { name: 'Próximo capítulo', exact: true }).click();
  await page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true }).click();
  await expect.poll(async () => (await accountState(page)).completedChapters['genesis:2']).toBe(true);
  expect((await accountState(page)).completedChapters['genesis:1']).not.toBe(true);
  const retained = await page.evaluate(id => sessionStorage.getItem(`vereda.rejected.v1.${id}`), user.id);
  expect(retained).toContain('genesis:1');
  expect(retained).not.toContain(password);
  expect(retained).not.toContain(firstEmail);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar alterações pendentes', exact: true }).click();
  const download = await downloading;
  const downloaded = await readFile((await download.path())!, 'utf8');
  expect(downloaded).toContain('genesis:1');
  expect(downloaded).not.toContain(password);
  expect(downloaded).not.toContain(firstEmail);

  // A cookie changed in another tab must not retry the rejected data under
  // the new account, even though this tab retains the first account's backup.
  const second = await page.request.post('/api/auth/register', { data: { name: 'Outra conta isolada', email: address(), password } });
  expect(second.status()).toBe(201);
  await page.reload();
  await expect(page.locator('.account-chip')).toContainText('Outra conta isolada');
  await expect(page.locator('.sidebar-sync')).toHaveText('Sincronizado com sua conta');
  expect((await accountState(page)).completedChapters).toEqual({});
  await expect(page.getByRole('button', { name: 'Baixar alterações pendentes', exact: true })).toHaveCount(0);
  const returning = await page.request.post('/api/auth/login', { data: { email: firstEmail, password } });
  expect(returning.ok()).toBe(true);
  await page.reload();
  await expect(page.locator('.account-chip')).toContainText('Conta de origem');
  await expect(page.locator('.sidebar-sync')).toHaveText('Algumas alterações não foram salvas');
  await page.unroute('**/api/state');
  await page.getByRole('button', { name: 'Tentar sincronizar novamente', exact: true }).click();
  await expect.poll(async () => (await accountState(page)).completedChapters).toMatchObject({ 'genesis:1': true, 'genesis:2': true });
  await expect(page.locator('.sidebar-sync')).toHaveText('Sincronizado com sua conta');
  await expect(page.getByRole('button', { name: 'Baixar alterações pendentes', exact: true })).toHaveCount(0);
});

test('uma importação recusada preserva as leituras originais do visitante mesmo após perder os dados da aba', async ({ page }) => {
  await page.goto('/');
  await bible(page);
  await page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true }).click();
  const guestState = () => page.evaluate(() => JSON.parse(localStorage.getItem('vereda.guest.v1') || '{}').state);
  await expect.poll(async () => (await guestState())?.completedChapters['genesis:1']).toBe(true);
  const originalGuest = await guestState();
  expect(originalGuest.lastReading).toMatchObject({ bookId: 'genesis', chapter: 1 });
  await page.route('**/api/state', async route => {
    if (route.request().method() === 'PATCH' && route.request().postDataJSON().completedChapters?.['genesis:1'] === true) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Importação de teste recusada.' }) });
    } else await route.continue();
  });
  const dialog = await openAccess(page);
  await dialog.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await dialog.getByLabel('Nome', { exact: true }).fill('Leitora preservando visitante');
  await dialog.getByLabel('E-mail', { exact: true }).fill(address());
  await dialog.getByLabel('Senha', { exact: true }).fill(password);
  await dialog.getByRole('checkbox', { name: importLabel, exact: true }).check();
  await dialog.getByRole('button', { name: 'Criar minha conta', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.account-chip')).toContainText('Leitora preservando visitante');
  await expect(page.locator('.sidebar-sync')).toHaveText('Algumas alterações não foram salvas');
  expect((await accountState(page)).completedChapters['genesis:1']).not.toBe(true);
  expect(await guestState()).toEqual(originalGuest);

  // Tab-local recovery may disappear when the tab closes. The original guest
  // readings must survive independently because their import was not confirmed.
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.locator('.account-chip')).toContainText('Leitora preservando visitante');
  await expect(page.locator('.sidebar-sync')).toHaveText('Sincronizado com sua conta');
  expect(await guestState()).toEqual(originalGuest);
  await bible(page);
  await page.getByRole('button', { name: 'Próximo capítulo', exact: true }).click();
  await page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true }).click();
  await expect.poll(async () => (await accountState(page)).completedChapters['genesis:2']).toBe(true);
  expect(await guestState()).toEqual(originalGuest);
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar ou criar conta', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Capítulo', exact: true }).selectOption('1');
  await expect(page.getByRole('button', { name: 'Desfazer leitura do capítulo', exact: true })).toBeVisible();
  await page.unroute('**/api/state');
});

for (const failure of ['503', 'JSON inválido com status 200'] as const) {
test(`falha ${failure} após salvar um quiz mantém a fila no recarregamento e recupera sem duplicar o resultado`, async ({ page }) => {
  const email = address();
  const registration = await page.request.post('/api/auth/register', { data: { name: 'Leitor com conexão instável', email, password } });
  expect(registration.status()).toBe(201);
  const { user } = await registration.json();
  await page.goto('/#quiz');
  await expect(page.locator('.account-chip')).toContainText('Leitor com conexão instável');
  await expect(page.locator('.sidebar-sync')).toHaveText('Sincronizado com sua conta');
  const data: Catalog = await (await page.request.get('/api/catalog')).json();
  const quiz = data.studies.quizzes[0];
  let acknowledgedByServer = false;
  await page.route('**/api/state', async route => {
    if (route.request().method() !== 'PATCH') { await route.continue(); return; }
    if (!acknowledgedByServer && route.request().postDataJSON().quizAttempts?.length) {
      const saved = await route.fetch();
      expect(saved.ok()).toBe(true);
      acknowledgedByServer = true;
    }
    // Both a failed status and a malformed successful acknowledgement must
    // preserve the pending operation even when the server committed the write.
    await route.fulfill(failure === '503'
      ? { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Falha temporária de teste.' }) }
      : { status: 200, contentType: 'application/json', body: '{"state":' });
  });
  await page.locator('.quiz-catalog-card').filter({ has: page.getByRole('heading', { name: quiz.title, exact: true }) }).click();
  for (const [index, question] of quiz.questions.entries()) {
    const radio = page.getByRole('radio', { name: question.choices[question.answerIndex], exact: true });
    await page.locator('.quiz-choice').filter({ has: radio }).click();
    await page.getByRole('button', { name: 'Confirmar resposta', exact: true }).click();
    await page.getByRole('button', { name: index === quiz.questions.length - 1 ? 'Ver resultado' : 'Próxima pergunta', exact: true }).click();
  }
  await expect(page.locator('.sidebar-sync')).toHaveText('Aguardando conexão');
  expect(acknowledgedByServer).toBe(true);
  const confirmed = await accountState(page);
  expect(confirmed.quizAttempts).toHaveLength(1);
  const attemptId = confirmed.quizAttempts[0].id;
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page.getByText(/Ainda há progresso aguardando sincronização/)).toBeVisible();
  await expect(page.locator('.account-chip')).toContainText('Leitor com conexão instável');
  expect((await (await page.request.get('/api/session')).json()).user.id).toBe(user.id);
  await page.reload();
  await expect(page.locator('.account-chip')).toContainText('Leitor com conexão instável');
  await expect(page.locator('.sidebar-sync')).toHaveText('Aguardando conexão');
  const pending = await page.evaluate(id => sessionStorage.getItem(`vereda.pending.v2.${id}`), user.id);
  expect(pending).toContain(attemptId);
  expect(pending).not.toContain(password);
  await page.unroute('**/api/state');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.sidebar-sync')).toHaveText('Sincronizado com sua conta');
  const recovered = await accountState(page);
  expect(recovered.quizAttempts).toHaveLength(1);
  expect(recovered.quizAttempts[0]).toMatchObject({ id: attemptId, score: quiz.questions.length, total: quiz.questions.length, quizRevision: quiz.revision ?? 1 });
  expect(recovered.quizAttempts[0].answers).toEqual(quiz.questions.map(question => question.answerIndex));
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar ou criar conta', exact: true })).toBeVisible();
  await login(page, email);
  expect((await accountState(page)).quizAttempts).toHaveLength(1);
});
}
