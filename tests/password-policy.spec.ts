import { expect, test } from '@playwright/test';

test('cadastro explica a regra, recusa senha sem letra ou símbolo e permite seis caracteres sem exigir número', async ({ page }) => {
  const email = `senha-${crypto.randomUUID()}@example.test`;
  let registrations = 0;
  let logins = 0;
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    if (request.url().endsWith('/api/auth/register')) registrations++;
    if (request.url().endsWith('/api/auth/login')) logins++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^(Entrar na conta|Entrar ou criar conta)$/ }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await dialog.getByLabel('Nome', { exact: true }).fill('Leitora de senha');
  await dialog.getByLabel('E-mail', { exact: true }).fill(email);
  const password = dialog.getByLabel('Senha', { exact: true });
  await expect(password).toHaveAttribute('minlength', '6');
  await expect(dialog.locator('#password-help')).toContainText('uma letra e um caractere especial');
  const submit = dialog.getByRole('button', { name: 'Criar minha conta', exact: true });

  await password.fill('abcdef');
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('pelo menos um caractere especial');
  await password.fill('12345!');
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('pelo menos uma letra');
  await password.fill('abcde ');
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('pelo menos um caractere especial');
  expect(registrations).toBe(0);

  await password.fill('ábcde!');
  await submit.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.account-chip')).toContainText('Leitora de senha');
  expect(registrations).toBe(1);
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await page.getByRole('button', { name: 'Entrar ou criar conta', exact: true }).click();
  await dialog.getByLabel('E-mail', { exact: true }).fill(email);
  await expect(password).toHaveAttribute('minlength', '1');
  // Login must reach the server even when an older password has no symbol.
  await password.fill('antiga');
  await dialog.getByRole('button', { name: 'Entrar na minha conta', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('E-mail ou senha incorretos.');
  expect(logins).toBe(1);
  await password.fill('ábcde!');
  await dialog.getByRole('button', { name: 'Entrar na minha conta', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.account-chip')).toContainText('Leitora de senha');
  expect(logins).toBe(2);
});
