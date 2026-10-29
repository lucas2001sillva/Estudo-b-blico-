import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { createApp } from '../server/app.mjs';

const password = 'verification-only-long-password';
const address = 'verification@example.test';

async function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'vereda-auth-backend-'));
  mkdirSync(path.join(directory, 'source-pdfs'));
  const content = {
    bible: { version: 'test', books: [{ id: 'genesis', name: 'Gênesis', abbreviation: 'Gn', testament: 'AT', chapters: [{ number: 1, sourcePages: [1], verses: [{ number: 1, text: 'No princípio Deus criou os céus e a terra.' }] }] }] },
    studies: { sources: [{ id: 'study-1', file: 'study-1.pdf', title: 'Estudo', totalPages: 1 }], trails: [{ id: 'intro', lessonIds: ['intro'] }], lessons: [{ id: 'intro', sourceId: 'study-1' }], quizzes: [] },
    passages: [],
  };
  for (const [file, value] of Object.entries(content)) writeFileSync(path.join(directory, `${file}.json`), JSON.stringify(value));
  writeFileSync(path.join(directory, 'source-pdfs', 'study-1.pdf'), '%PDF-1.4\nfixture');
  const client = createClient({ url: pathToFileURL(path.join(directory, 'state.sqlite')).href });
  const fault = { all: false, stateRead: false, sessionWrite: false, events: [] };
  const databaseClient = {
    async execute(statement) {
      const sql = typeof statement === 'string' ? statement : statement.sql;
      const readingState = sql.includes('SELECT state_json, revision FROM user_states');
      if (readingState) fault.events.push('read-state');
      if (fault.all || (fault.stateRead && readingState)) throw new Error('synthetic-private-database-details');
      return client.execute(statement);
    },
    async batch(statements, mode) {
      const sessionWrite = statements.some(statement => (typeof statement === 'string' ? statement : statement.sql).includes('INSERT INTO sessions'));
      if (sessionWrite) fault.events.push('write-session');
      if (fault.all || (fault.sessionWrite && sessionWrite)) throw new Error('synthetic-private-database-details');
      return client.batch(statements, mode);
    },
    transaction: mode => client.transaction(mode),
    close: () => client.close(),
  };
  const app = await createApp({ dataDir: directory, dbPath: path.join(directory, 'state.sqlite'), databaseClient, distDir: path.join(directory, 'no-dist'), rateLimitEnabled: false, logger: { error() {} } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, { method = 'GET', body, cookie } = {}) => {
    const response = await fetch(origin + route, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = response.headers.get('content-type')?.includes('application/json');
    return { status: response.status, headers: response.headers, data: json ? await response.json() : await response.text(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const register = () => request('/api/auth/register', { method: 'POST', body: { name: 'Verificação isolada', email: address, password } });
  const login = (cookie, route = '/api/auth/login') => request(route, { method: 'POST', body: { email: address, password }, cookie });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await app.locals.close(); rmSync(directory, { recursive: true, force: true }); });
  return { request, register, login, fault, client };
}

test('cadastro retorna o estado inicial confirmado sem depender de uma segunda leitura', async t => {
  const { register, fault, client } = await fixture(t);
  // The account transaction can succeed while a later SELECT is unavailable.
  fault.stateRead = true;
  const created = await register();
  assert.equal(created.status, 201);
  assert.ok(created.cookie);
  assert.equal(created.data.revision, 0);
  assert.deepEqual(created.data.state.completedChapters, {});
  assert.deepEqual(created.data.state.quizAttempts, []);
  const row = (await client.execute('SELECT state_json, revision FROM user_states')).rows[0];
  assert.deepEqual(created.data.state, JSON.parse(row.state_json));
  assert.equal(Number(row.revision), created.data.revision);
  assert.ok(!fault.events.includes('read-state'));
});

test('login devolve progresso e revisão na mesma resposta e lê antes de emitir a sessão', async t => {
  const { request, register, login, fault } = await fixture(t);
  const created = await register();
  const saved = await request('/api/state', { method: 'PATCH', cookie: created.cookie, body: {
    completedChapters: { 'genesis:1': true }, completedLessons: { intro: true },
    preferences: { theme: 'dark', fontSize: 24 }, selectedTrailId: 'intro', lastReading: { bookId: 'genesis', chapter: 1, verse: 1 },
  } });
  assert.equal(saved.status, 200);
  fault.events.length = 0;
  const authenticated = await login();
  assert.equal(authenticated.status, 200);
  assert.ok(authenticated.cookie);
  assert.equal(authenticated.data.user.id, created.data.user.id);
  assert.deepEqual(authenticated.data.state, saved.data.state);
  assert.equal(authenticated.data.revision, saved.data.revision);
  assert.deepEqual(fault.events, ['read-state', 'write-session']);
});

test('falha ao ler o progresso impede novo cookie e conserva a sessão anterior', async t => {
  const { request, register, login, fault, client } = await fixture(t);
  const created = await register();
  fault.events.length = 0;
  fault.stateRead = true;
  const rejected = await login(created.cookie, '/api/AuTh/LoGiN/');
  assert.equal(rejected.status, 503);
  assert.equal(rejected.headers.get('set-cookie'), null);
  assert.doesNotMatch(JSON.stringify(rejected.data), /synthetic-private/);
  assert.deepEqual(fault.events, ['read-state']);
  assert.equal(Number((await client.execute('SELECT count(*) AS count FROM sessions')).rows[0].count), 1);
  fault.stateRead = false;
  assert.equal((await request('/api/session', { cookie: created.cookie })).data.user.id, created.data.user.id);
});

test('falha ao gravar a sessão não confirma login nem remove a sessão e progresso anteriores', async t => {
  const { request, register, login, fault, client } = await fixture(t);
  const created = await register();
  await request('/api/state', { method: 'PATCH', cookie: created.cookie, body: { completedChapters: { 'genesis:1': true } } });
  fault.sessionWrite = true;
  const rejected = await login(created.cookie);
  assert.equal(rejected.status, 503);
  assert.equal(rejected.headers.get('set-cookie'), null);
  assert.equal(Number((await client.execute('SELECT count(*) AS count FROM sessions')).rows[0].count), 1);
  fault.sessionWrite = false;
  assert.equal((await request('/api/state', { cookie: created.cookie })).data.state.completedChapters['genesis:1'], true);
});

test('falha do banco não bloqueia leitura pública com cookie e mantém erros nas rotas privadas', async t => {
  const { request, register, fault } = await fixture(t);
  const created = await register();
  fault.all = true;
  for (const route of ['/api/catalog', '/api/CaTaLoG/', '/api/bible/genesis/1', '/api/search?q=Gn1.1', '/api/sources/study-1']) {
    assert.equal((await request(route, { cookie: created.cookie })).status, 200, route);
  }
  for (const route of ['/api/session', '/api/SeSsIoN/', '/api/state', '/api/StAtE/', '/api/health']) {
    const rejected = await request(route, { cookie: created.cookie });
    assert.equal(rejected.status, 503, route);
    assert.equal(rejected.headers.get('set-cookie'), null);
    assert.equal(rejected.data.user, undefined);
    assert.equal(rejected.data.state, undefined);
  }
  const logout = await request('/api/auth/logout/', { method: 'POST', cookie: created.cookie, body: {} });
  assert.equal(logout.status, 503);
  assert.equal(logout.headers.get('set-cookie'), null);
});
