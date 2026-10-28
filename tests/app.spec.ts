import { expect, test, type Page } from '@playwright/test';

const password = 'Vereda-teste-2026!';
const uniqueEmail = () => `leitor-${crypto.randomUUID()}@example.test`;

async function navigate(page: Page, name: string) {
  await page.getByRole('link', { name, exact: true }).filter({ visible: true }).first().click();
}

async function openBible(page: Page) {
  await navigate(page, 'Bíblia');
  await expect(page.getByRole('heading', { name: 'Leia a Bíblia', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Marcar capítulo como lido|Desfazer leitura do capítulo/ })).toBeEnabled();
}

async function registerThroughInterface(page: Page, email: string, name: string) {
  await page.getByRole('button', { name: /^(Entrar na conta|Entrar ou criar conta)$/ }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await dialog.getByLabel('Nome', { exact: true }).fill(name);
  await dialog.getByLabel('E-mail', { exact: true }).fill(email);
  await dialog.getByLabel('Senha', { exact: true }).fill(password);
  const importProgress = dialog.getByRole('checkbox', { name: 'Adicionar minhas leituras deste navegador à conta', exact: true });
  if (await importProgress.count()) await importProgress.check();
  await dialog.getByRole('button', { name: 'Criar minha conta', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('leitura pública: 50 passagens, navegação e pesquisa de João 3:16', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle(/Vereda Bíblica/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/de 50 passagens selecionadas/)).toBeVisible();
  const previous = await page.locator('.daily-passage blockquote').innerText();
  await page.getByRole('button', { name: 'Próxima passagem', exact: true }).click();
  await expect(page.locator('.daily-passage blockquote')).not.toHaveText(previous);
  await openBible(page);
  await expect(page.locator('.verses p').first()).toContainText('No princípio Deus criou');
  const search = page.getByLabel('Buscar na Bíblia', { exact: true });
  await search.fill('João 3:16');
  await search.press('Enter');
  await expect(page.locator('#verse-16')).toContainText('Porque Deus tanto amou o mundo');
  await expect(page.getByRole('combobox', { name: 'Capítulo', exact: true })).toHaveValue('3');
  expect(errors).toEqual([]);
});

test('conclusão e reversão de capítulo persistem para visitante', async ({ page }) => {
  await page.goto('/');
  await openBible(page);
  await expect(page.getByRole('progressbar', { name: 'Progresso geral da Bíblia', exact: true })).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Progresso geral da Bíblia', exact: true })).toHaveAttribute('aria-valuenow', '1');
  await page.reload();
  await openBible(page);
  await page.getByRole('button', { name: 'Desfazer leitura do capítulo', exact: true }).click();
  await page.reload();
  await openBible(page);
  await expect(page.getByRole('progressbar', { name: 'Progresso geral da Bíblia', exact: true })).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true })).toBeVisible();
});

test('cadastro pela interface e sincronização em dois dispositivos preservam isolamento', async ({ page, browser, baseURL }) => {
  const email = uniqueEmail();
  await page.goto('/');
  await openBible(page);
  await page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true }).click();
  await registerThroughInterface(page, email, 'Leitora de teste');
  await openBible(page);
  await expect(page.getByRole('button', { name: 'Desfazer leitura do capítulo', exact: true })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).state.completedChapters['genesis:1']).toBe(true);

  const secondDevice = await browser.newContext({ baseURL });
  const otherAccount = await browser.newContext({ baseURL });
  try {
    const login = await secondDevice.request.post('/api/auth/login', { data: { email, password } });
    expect(login.ok()).toBe(true);
    const second = await secondDevice.newPage();
    await second.goto('/');
    await openBible(second);
    await expect(second.getByRole('button', { name: 'Desfazer leitura do capítulo', exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Próximo capítulo', exact: true }).click();
    await second.getByRole('button', { name: 'Marcar capítulo como lido', exact: true }).click();
    await expect.poll(async () => (await (await second.request.get('/api/state')).json()).state.completedChapters['genesis:2']).toBe(true);
    await page.reload();
    await openBible(page);
    await expect(page.getByRole('progressbar', { name: 'Progresso geral da Bíblia', exact: true })).toHaveAttribute('aria-valuenow', '2');

    const register = await otherAccount.request.post('/api/auth/register', { data: { name: 'Outra leitora', email: uniqueEmail(), password } });
    expect(register.status()).toBe(201);
    const otherState = await (await otherAccount.request.get('/api/state')).json();
    expect(otherState.state.completedChapters).toEqual({});
    const otherPage = await otherAccount.newPage();
    await otherPage.goto('/');
    await openBible(otherPage);
    await expect(otherPage.getByRole('progressbar', { name: 'Progresso geral da Bíblia', exact: true })).toHaveAttribute('aria-valuenow', '0');
    const cookie = (await secondDevice.cookies()).find(item => item.name === 'vereda_session');
    expect(cookie?.httpOnly).toBe(true);
  } finally {
    await secondDevice.close();
    await otherAccount.close();
  }
});

test('trilha livre, conclusão de estudo e quiz com respostas persistidas e sincronizadas', async ({ page, browser, baseURL }) => {
  await page.goto('/');
  const { studies } = await (await page.request.get('/api/catalog')).json();
  const trail = studies.trails.find((item: { recommended: boolean }) => !item.recommended) || studies.trails[0];
  const lesson = studies.lessons.find((item: { id: string }) => trail.lessonIds.includes(item.id));
  const quiz = studies.quizzes.find((item: { questions: unknown[] }) => item.questions.length > 0);
  expect(trail).toBeTruthy();
  expect(lesson).toBeTruthy();
  expect(quiz).toBeTruthy();
  await navigate(page, 'Estudos');
  const trailCard = page.locator('.study-trail-card').filter({ has: page.getByRole('heading', { name: trail.title, exact: true }) });
  await trailCard.click();
  await expect(trailCard).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.study-lesson-card').filter({ has: page.getByRole('heading', { name: lesson.title, exact: true }) }).click();
  await expect(page.getByRole('heading', { level: 1, name: lesson.title, exact: true })).toBeVisible();
  const original = page.getByRole('link', { name: /Consultar o PDF/ });
  await expect(original).toHaveAttribute('href', new RegExp(`/api/sources/${lesson.sourceId}#page=${lesson.startPage}`));
  const source = await page.request.get(`/api/sources/${lesson.sourceId}`);
  expect(source.ok()).toBe(true);
  expect(source.headers()['content-type']).toContain('application/pdf');
  await page.getByRole('button', { name: 'Concluir leitura', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Leitura concluída · desfazer', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await navigate(page, 'Estudos');
  await page.locator('.study-lesson-card').filter({ has: page.getByRole('heading', { name: lesson.title, exact: true }) }).click();
  await expect(page.getByRole('button', { name: 'Leitura concluída · desfazer', exact: true })).toBeVisible();

  await navigate(page, 'Quiz');
  await page.locator('.quiz-catalog-card').filter({ has: page.getByRole('heading', { name: quiz.title, exact: true }) }).click();
  for (let i = 0; i < quiz.questions.length; i++) {
    const question = quiz.questions[i];
    await expect(page.getByRole('heading', { level: 1, name: question.prompt, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar resposta', exact: true })).toBeDisabled();
    await page.getByText(question.choices[question.answerIndex], { exact: true }).click();
    await expect(page.getByRole('radio', { name: question.choices[question.answerIndex], exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Confirmar resposta', exact: true }).click();
    await expect(page.locator('.quiz-feedback')).toContainText(question.explanation);
    await expect(page.locator('.quiz-feedback a')).toHaveAttribute('href', new RegExp(`/api/sources/${question.source.sourceId}#page=${question.source.page}`));
    await page.getByRole('button', { name: i === quiz.questions.length - 1 ? 'Ver resultado' : 'Próxima pergunta', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Você se saiu muito bem!', exact: true })).toBeVisible();
  await expect(page.locator('.quiz-score')).toHaveText(new RegExp(`${quiz.questions.length}\\s*/\\s*${quiz.questions.length}`));
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('heading', { name: quiz.questions[0].prompt, exact: true })).toBeVisible();
  await page.reload();
  await navigate(page, 'Meu progresso');
  await expect(page.locator('.attempt-list')).toContainText(quiz.title);
  await expect(page.locator('.attempt-list > div')).toHaveCount(1);

  const email = uniqueEmail();
  await registerThroughInterface(page, email, 'Leitor de quizzes');
  const expectedAnswers = quiz.questions.map((question: { answerIndex: number }) => question.answerIndex);
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).state.quizAttempts[0]?.answers).toEqual(expectedAnswers);
  const secondDevice = await browser.newContext({ baseURL });
  try {
    const login = await secondDevice.request.post('/api/auth/login', { data: { email, password } });
    expect(login.ok()).toBe(true);
    const second = await secondDevice.newPage();
    await second.goto('/#quiz');
    const item = second.locator('.quiz-catalog-item').filter({ has: second.getByRole('heading', { name: quiz.title, exact: true }) });
    await item.locator('.quiz-attempt-history > summary').click();
    await expect(item.locator('.quiz-history-attempt')).toHaveCount(1);
    await item.locator('.quiz-history-attempt > summary').click();
    for (const question of quiz.questions) {
      const review = item.locator('.quiz-review-item').filter({ has: second.getByRole('heading', { name: new RegExp(question.prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }) });
      await expect(review).toContainText(question.choices[question.answerIndex]);
      await expect(review.locator('a')).toHaveAttribute('href', new RegExp(`/api/sources/${question.source.sourceId}#page=${question.source.page}`));
    }
  } finally {
    await secondDevice.close();
  }
});

test('tema e tamanho de letra persistem; controles são acessíveis por teclado', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openBible(page);
  const oldSize = await page.locator('.verses p').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  const accessibility = page.getByRole('button', { name: 'Acessibilidade', exact: true });
  await accessibility.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Preferências de leitura', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Aumentar letra', exact: true }).click();
  await page.getByRole('button', { name: 'Aumentar letra', exact: true }).click();
  const biggerSize = await page.locator('.verses p').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(biggerSize).toBeGreaterThan(oldSize);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openBible(page);
  await expect.poll(async () => page.locator('.verses p').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBe(biggerSize);
  await expect(page.getByRole('main')).toHaveCount(1);
  await page.getByRole('link', { name: 'Pular para o conteúdo', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

test('celular: navegação, escolha de livro e leitura sem rolagem horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Navegação para celular', exact: true })).toBeVisible();
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await noOverflow();
  await openBible(page);
  await page.getByRole('button', { name: 'Escolher livro', exact: true }).click();
  await page.getByLabel('Filtrar livros', { exact: true }).fill('João');
  await page.locator('.book-list').getByRole('button', { name: /^João\s+21$/ }).click();
  await page.getByRole('combobox', { name: 'Capítulo', exact: true }).selectOption('3');
  await expect(page.locator('#verse-16')).toContainText('Porque Deus tanto amou o mundo');
  await noOverflow();
  await page.getByRole('button', { name: 'Acessibilidade', exact: true }).click();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Aumentar letra', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar preferências', exact: true }).click();
  await noOverflow();
  await navigate(page, 'Estudos');
  await expect(page.getByRole('heading', { name: 'Escolha sua trilha', exact: true })).toBeVisible();
  await noOverflow();
});

test('uma resposta antiga de sincronização não apaga capítulo marcado durante a atualização', async ({ page }) => {
  const registration = await page.request.post('/api/auth/register', { data: { name: 'Leitor de sincronização', email: uniqueEmail(), password } });
  expect(registration.status()).toBe(201);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sair da conta', exact: true })).toBeVisible();
  await openBible(page);
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).state.lastReading?.bookId).toBe('genesis');
  await expect(page.locator('.sidebar-sync')).toHaveText('Sincronizado com sua conta');
  let releaseResponse!: () => void;
  let responseCaptured = false;
  let deliveredResponse!: () => void;
  const release = new Promise<void>(resolve => { releaseResponse = resolve; });
  const delivered = new Promise<void>(resolve => { deliveredResponse = resolve; });
  let intercept = true;
  await page.route('**/api/state', async route => {
    if (!intercept || route.request().method() !== 'GET') { await route.continue(); return; }
    intercept = false;
    const response = await route.fetch();
    responseCaptured = true;
    await release;
    await route.fulfill({ response });
    deliveredResponse();
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => responseCaptured).toBe(true);
    await page.getByRole('button', { name: 'Marcar capítulo como lido', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/state')).json()).state.completedChapters['genesis:1']).toBe(true);
    releaseResponse();
    await delivered;
    await expect(page.getByRole('button', { name: 'Desfazer leitura do capítulo', exact: true })).toBeVisible();
    await page.reload();
    await openBible(page);
    await expect(page.getByRole('progressbar', { name: 'Progresso geral da Bíblia', exact: true })).toHaveAttribute('aria-valuenow', '1');
  } finally {
    releaseResponse();
    await page.unroute('**/api/state');
  }
});
