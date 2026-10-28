import { expect, test, type Page } from '@playwright/test';

const password = 'Frase de teste privada 2026!';
const email = () => `privacidade-${crypto.randomUUID()}@example.test`;
const importLabel = 'Adicionar minhas leituras deste navegador à conta';

async function bible(page: Page) {
  await page.getByRole('link', { name: 'Bíblia', exact: true }).filter({ visible: true }).first().click();
  await expect(page.getByRole('button', { name: /Marcar capítulo como lido|Desfazer leitura do capítulo/ })).toBeEnabled();
}

async function register(page: Page, address: string, importGuest = false) {
  await page.getByRole('button', { name: /^(Entrar na conta|Entrar ou criar conta)$/ }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await dialog.getByLabel('Nome', { exact: true }).fill('Leitora privada');
  await dialog.getByLabel('E-mail', { exact: true }).fill(address);
  await dialog.getByLabel('Senha', { exact: true }).fill(password);
  const choice = dialog.getByRole('checkbox', { name: importLabel, exact: true });
  await expect(choice).not.toBeChecked();
  if (importGuest) await choice.check();
  await dialog.getByRole('button', { name: 'Criar minha conta', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('leituras de visitante só entram na conta mediante escolha explícita', async ({ page }) => {
  await page.goto('/');
  await bible(page);
  await page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true }).click();
  await register(page, email());
  await expect(page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true })).toBeVisible();
  const account = await (await page.request.get('/api/state')).json();
  expect(account.state.completedChapters).toEqual({});
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar ou criar conta', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desfazer leitura do capítulo', exact: true })).toBeVisible();
  expect((await page.request.get('/api/state')).status()).toBe(401);
});

test('importação confirmada limpa as leituras de visitante sem perder o progresso da conta', async ({ page }) => {
  await page.goto('/');
  await bible(page);
  await page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true }).click();
  await register(page, email(), true);
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).state.completedChapters['genesis:1']).toBe(true);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('vereda.guest.v1') || '{}').state?.completedChapters)).toEqual({});
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar ou criar conta', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true })).toBeVisible();
});

test('histórico privado não fica em localStorage e caches antigos são removidos', async ({ page }) => {
  const address = email();
  const registration = await page.request.post('/api/auth/register', { data: { name: 'Perfil privado', email: address, password } });
  expect(registration.status()).toBe(201);
  const { user } = await registration.json();
  expect((await page.request.patch('/api/state', { data: { completedChapters: { 'genesis:1': true } } })).ok()).toBe(true);
  await page.addInitScript(() => {
    localStorage.setItem('vereda.account.old', JSON.stringify({ user: { name: 'Perfil legado privado' }, state: { completedChapters: { 'mateus:2': true } } }));
    localStorage.setItem('vereda.active.v1', JSON.stringify({ user: { id: 'old', name: 'Perfil legado privado' }, state: { completedChapters: { 'mateus:2': true } }, queue: [] }));
  });
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sair da conta', exact: true })).toBeVisible();
  await bible(page);
  await expect(page.getByRole('button', { name: 'Desfazer leitura do capítulo', exact: true })).toBeVisible();
  const widthRatio = await page.getByRole('progressbar', { name: 'Progresso de Gênesis', exact: true }).evaluate(element => element.firstElementChild!.getBoundingClientRect().width / element.getBoundingClientRect().width);
  expect(widthRatio).toBeCloseTo(1 / 50, 2);
  const stored = await page.evaluate(() => ({ persistent: { ...localStorage }, temporary: { ...sessionStorage } }));
  expect(Object.keys(stored.persistent).filter(key => key === 'vereda.active.v1' || key.startsWith('vereda.account.'))).toEqual([]);
  expect(JSON.stringify(stored.persistent)).not.toContain(address);
  expect(JSON.stringify(stored.persistent)).not.toContain(user.id);
  expect(JSON.stringify(stored.persistent)).not.toContain('genesis:1');
  expect(JSON.stringify(stored.temporary)).not.toContain(address);
  expect(JSON.stringify(stored.temporary)).not.toContain(password);
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar ou criar conta', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('vereda.pending.')))).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test('uma fila pendente não é enviada para a conta que substituiu o cookie em outra aba', async ({ page }) => {
  const firstEmail = email();
  const first = await page.request.post('/api/auth/register', { data: { name: 'Primeira conta', email: firstEmail, password } });
  expect(first.status()).toBe(201);
  const { user: firstUser } = await first.json();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sair da conta', exact: true })).toBeVisible();
  await bible(page);
  await expect(page.locator('.sidebar-sync')).toHaveText('Sincronizado com sua conta');
  await page.route('**/api/state', async route => {
    if (route.request().method() === 'PATCH') await route.abort('failed');
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true }).click();
  await expect(page.locator('.sidebar-sync')).toHaveText('Aguardando conexão');
  await expect(page.getByText('A sincronização está indisponível. Mantenha esta aba aberta até aparecer “Sincronizado com sua conta”.', { exact: true })).toBeVisible();
  await page.unroute('**/api/state');
  const second = await page.request.post('/api/auth/register', { data: { name: 'Segunda conta', email: email(), password } });
  expect(second.status()).toBe(201);
  const rejected = page.waitForResponse(response => response.url().endsWith('/api/state') && response.request().method() === 'PATCH' && response.status() === 409);
  await page.getByRole('button', { name: 'Próximo capítulo', exact: true }).click();
  const response = await rejected;
  expect(response.request().headers()['x-vereda-account']).toBe(firstUser.id);
  await expect(page.locator('.account-chip')).toContainText('Segunda conta');
  const secondState = await (await page.request.get('/api/state')).json();
  expect(secondState.state.completedChapters).toEqual({});
  const retained = await page.evaluate(id => JSON.parse(sessionStorage.getItem(`vereda.pending.v2.${id}`) || '{}').queue, firstUser.id);
  expect(retained.some((operation: { patch: { completedChapters?: Record<string, boolean> } }) => operation.patch.completedChapters?.['genesis:1'])).toBe(true);
  expect((await page.request.post('/api/auth/login', { data: { email: firstEmail, password } })).ok()).toBe(true);
  await page.reload();
  await expect(page.locator('.account-chip')).toContainText('Primeira conta');
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).state.completedChapters['genesis:1']).toBe(true);
});
