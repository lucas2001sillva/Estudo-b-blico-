/**
 * Optional network integration check against the official libSQL server.
 * Run: node scripts/check-remote-database.mjs (requires Docker).
 * Source: https://raw.githubusercontent.com/tursodatabase/libsql/main/docs/DOCKER.md
 * The database is temporary and exposed only on 127.0.0.1. No Turso account or
 * credentials are used. This tests the HTTP protocol, not hosted Turso or TLS.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { createApp } from '../server/app.mjs';
import { createDatabaseFetch } from '../server/database.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = 'ghcr.io/tursodatabase/libsql-server@sha256:6dd3eb276d9d3604e4a48ac4a999a2e267814732d57d7e94c04ba71482333a67';
const identifier = `vereda-libsql-${randomUUID()}`;
const volume = `${identifier}-data`;
const temporary = mkdtempSync(path.join(tmpdir(), 'vereda-remote-check-'));
const forbiddenLocal = path.join(temporary, 'must-not-be-created.sqlite');
const applications = new Set();
let madeContainer = false;
let madeVolume = false;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const transport = () => createDatabaseFetch({ timeoutMs: 1500 });

async function waitForDatabase(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const probe = createClient({ url, fetch: transport() });
    try {
      const result = await probe.execute('SELECT 1 AS ready');
      if (Number(result.rows[0].ready) === 1) return;
    } catch { /* The newly started database can take a moment to bind its port. */ }
    finally { probe.close(); }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('O servidor libSQL temporário não ficou pronto.');
}

async function startApplication(databaseUrl) {
  const client = createClient({ url: databaseUrl, fetch: transport() });
  let app;
  try {
    app = await createApp({
      dataDir: path.join(root, 'content'),
      distDir: path.join(root, 'dist'),
      dbPath: forbiddenLocal,
      // Dependency injection permits an HTTP loopback test server while the
      // production constructor independently requires TLS and an actual token.
      databaseUrl: 'https://integration.invalid',
      databaseAuthToken: 'integration-only-not-a-real-credential',
      databaseClient: client,
      requireRemoteDatabase: true,
      databaseRequestTimeoutMs: 1500,
      rateLimitEnabled: false,
      logger: { error() {} },
    });
    assert.equal(app.locals.databaseMode, 'remote', 'A integração não pode usar SQLite local como fallback.');
    assert.equal(existsSync(forbiddenLocal), false);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const application = {
      app,
      origin,
      async request(route, { method = 'GET', body, cookie } = {}) {
        const response = await fetch(`${origin}/api${route}`, {
          method,
          headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(20_000),
        });
        const data = await response.json();
        return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
      },
      async close() {
        applications.delete(application);
        await new Promise(resolve => server.close(resolve));
        await app.locals.close();
      },
    };
    applications.add(application);
    return application;
  } catch (error) {
    if (app?.locals.close) await app.locals.close();
    else client.close();
    throw error;
  }
}

try {
  try { docker('image', 'inspect', image); }
  catch { docker('pull', image); }
  docker('volume', 'create', volume); madeVolume = true;
  docker('run', '-d', '--name', identifier,
    '--mount', `type=volume,source=${volume},target=/var/lib/sqld`,
    '-e', 'SQLD_NODE=primary', '-p', '127.0.0.1::8080', image);
  madeContainer = true;
  const mapping = docker('port', identifier, '8080/tcp');
  assert.match(mapping, /^127\.0\.0\.1:\d+$/);
  let databaseUrl = `http://${mapping}`;
  await waitForDatabase(databaseUrl);
  console.log('libSQL temporário pronto; verificando duas instâncias da API.');

  let first = await startApplication(databaseUrl);
  let second = await startApplication(databaseUrl);
  const catalog = await first.request('/catalog');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.data.books.length, 66);
  const quiz = catalog.data.studies.quizzes.find(item => item.questions.length > 0);
  const answers = quiz.questions.map(question => question.answerIndex);
  const account = { name: 'Integração temporária', email: `integration-${randomUUID()}@example.test`, password: `Aa!${randomBytes(24).toString('base64url')}` };
  const registered = await first.request('/auth/register', { method: 'POST', body: account });
  assert.equal(registered.status, 201);
  assert.ok(registered.cookie);
  const login = await second.request('/auth/login', { method: 'POST', body: { email: account.email, password: account.password } });
  assert.equal(login.status, 200);

  const attempts = [{ id: randomUUID(), quizId: quiz.id, total: answers.length, score: answers.length, answers, createdAt: new Date().toISOString() }];
  const results = await Promise.all([
    first.request('/state', { method: 'PATCH', cookie: registered.cookie, body: { completedChapters: { 'genesis:1': true }, preferences: { theme: 'dark' }, quizAttempts: attempts } }),
    second.request('/state', { method: 'PATCH', cookie: login.cookie, body: { completedChapters: { 'genesis:2': true }, preferences: { fontSize: 24 } } }),
  ]);
  for (const result of results) assert.equal(result.status, 200);
  const simultaneous = await second.request('/state', { cookie: login.cookie });
  assert.equal(simultaneous.data.state.completedChapters['genesis:1'], true);
  assert.equal(simultaneous.data.state.completedChapters['genesis:2'], true);
  assert.equal(simultaneous.data.state.preferences.theme, 'dark');
  assert.equal(simultaneous.data.state.preferences.fontSize, 24);
  assert.deepEqual(simultaneous.data.state.quizAttempts[0].answers, answers);
  console.log('Alterações concorrentes e respostas de quiz preservadas.');

  const duplicate = await second.request('/auth/register', { method: 'POST', body: account });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.cookie, undefined);
  docker('stop', identifier);
  const unavailable = await first.request('/auth/register', { method: 'POST', body: { ...account, email: `unavailable-${randomUUID()}@example.test` } });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.cookie, undefined);
  assert.equal(existsSync(forbiddenLocal), false);
  console.log('Indisponibilidade respondeu sem cookie e sem fallback local.');
  await first.close(); await second.close();
  docker('start', identifier);
  // Docker may allocate a different host port when a dynamically published
  // container starts again. This is a test endpoint, not a production URL.
  const restartedMapping = docker('port', identifier, '8080/tcp');
  assert.match(restartedMapping, /^127\.0\.0\.1:\d+$/);
  databaseUrl = `http://${restartedMapping}`;
  await waitForDatabase(databaseUrl);
  first = await startApplication(databaseUrl);
  const restored = await first.request('/auth/login', { method: 'POST', body: { email: account.email, password: account.password } });
  assert.equal(restored.status, 200);
  const state = await first.request('/state', { cookie: restored.cookie });
  assert.equal(state.data.state.completedChapters['genesis:1'], true);
  assert.equal(state.data.state.completedChapters['genesis:2'], true);
  assert.deepEqual(state.data.state.quizAttempts[0].answers, answers);
  assert.equal(state.data.state.preferences.theme, 'dark');
  assert.equal(existsSync(forbiddenLocal), false);
  console.log('Integração HTTP libSQL validada: duas instâncias, alterações concorrentes, respostas de quiz, duplicidade de conta, indisponibilidade do banco e persistência após reiniciar API/banco; sem fallback local.');
} finally {
  for (const application of [...applications]) await application.close();
  if (madeContainer) docker('rm', '-f', identifier);
  if (madeVolume) docker('volume', 'rm', volume);
  rmSync(temporary, { recursive: true, force: true });
}
