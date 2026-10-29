import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';
import { createApp } from '../server/app.mjs';

const password = 'uma-frase-secreta-de-teste';
const state = () => ({ completedChapters: {}, completedLessons: {}, quizAttempts: [], preferences: { theme: 'light', fontSize: 18, speechRate: 1 }, selectedTrailId: null, lastReading: null });

async function site(t, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'vereda-security-'));
  const dbPath = path.join(directory, 'state.sqlite');
  mkdirSync(path.join(directory, 'source-pdfs'));
  writeFileSync(path.join(directory, 'bible.json'), JSON.stringify({ version: 'fixture', books: [{ id: 'genesis', name: 'Gênesis', abbreviation: 'Gn', testament: 'AT', chapters: [{ number: 1, sourcePages: [1], verses: [{ number: 1, text: 'Texto de teste.' }] }] }] }));
  writeFileSync(path.join(directory, 'studies.json'), JSON.stringify({ sources: [], trails: [], lessons: [], quizzes: [] }));
  writeFileSync(path.join(directory, 'passages.json'), '[]');
  writeFileSync(path.join(directory, 'source-pdfs', 'study-1.pdf'), '%PDF-1.4 fixture');
  const client = createClient({ url: pathToFileURL(dbPath).href });
  const fault = { failWrites: false, sessionQueries: 0 };
  const databaseClient = {
    async execute(statement) {
      const sql = typeof statement === 'string' ? statement : statement.sql;
      if (sql.includes('FROM sessions JOIN users')) fault.sessionQueries++;
      return client.execute(statement);
    },
    async batch(statements, mode) {
      if (fault.failWrites) throw Object.assign(new Error('synthetic-private-token-and-database-url'), { code: 'NETWORK_FAILURE' });
      return client.batch(statements, mode);
    },
    transaction: mode => client.transaction(mode),
    close: () => client.close(),
  };
  const logs = [];
  const app = await createApp({ dataDir: directory, dbPath, databaseClient, distDir: path.join(directory, 'no-dist'), rateLimitEnabled: false, logger: { error: (...values) => logs.push(values) }, ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, { method = 'GET', body, rawBody, cookie, headers = {} } = {}) => {
    const response = await fetch(`${origin}${route}`, { method, headers: { ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const type = response.headers.get('content-type') || '';
    return { status: response.status, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0], data: type.includes('application/json') ? await response.json() : await response.text() };
  };
  const register = async (email = 'security@example.test', registrationPassword = password, headers = {}) => request('/api/auth/register', { method: 'POST', body: { name: 'Leitor de teste', email, password: registrationPassword }, headers });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await app.locals.close(); rmSync(directory, { recursive: true, force: true }); });
  return { app, request, register, origin, dbPath, client, fault, logs };
}

test('cadastro exige seis caracteres, uma letra e um símbolo, aceita acentos e emite sessão de sete dias', async t => {
  const { register } = await site(t);
  for (const [label, value, message] of [
    ['short', 'abcd!', /entre 6 e 128/],
    ['unicode-short', 'a!😀😀', /entre 6 e 128/],
    ['no-letter', '12345!', /pelo menos uma letra/],
    ['no-special', 'abcdef', /caractere especial/],
    ['only-space', 'abcde ', /caractere especial/],
  ]) {
    const refused = await register(`${label}@example.test`, value);
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, message);
    assert.equal(refused.cookie, undefined);
  }
  // Exactly six characters, without a digit: numbers are optional.
  const allowed = await register('minimum@example.test', 'abcde!');
  assert.equal(allowed.status, 201);
  assert.match(allowed.headers.get('set-cookie'), /Max-Age=604800/);
  assert.equal((await register('accent@example.test', 'á1234!')).status, 201);
  assert.equal((await register('symbol@example.test', 'áaaaa😀')).status, 201);
  assert.equal((await register('long@example.test', `${'á'.repeat(127)}!`)).status, 201);
  assert.equal((await register('too-long@example.test', `${'á'.repeat(128)}!`)).status, 400);
});

test('senhas legadas continuam funcionando e são fortalecidas após autenticação', async t => {
  const { request, dbPath } = await site(t);
  const legacyPassword = 'legado12';
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(legacyPassword, salt, 64).toString('hex');
  const db = new DatabaseSync(dbPath);
  db.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').run('legacy-user', 'Legado', 'legacy@example.test', salt, hash, Date.now());
  db.prepare('INSERT INTO user_states(user_id,state_json,revision,updated_at) VALUES(?,?,0,?)').run('legacy-user', JSON.stringify(state()), Date.now());
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'legacy@example.test', password: legacyPassword } });
  assert.equal(login.status, 200);
  assert.match(db.prepare('SELECT password_hash FROM users WHERE id = ?').get('legacy-user').password_hash, /^scrypt-v2\$[a-f0-9]{128}$/);
  assert.equal((await request('/api/state', { cookie: login.cookie })).status, 200);
  const again = await request('/api/auth/login', { method: 'POST', body: { email: 'legacy@example.test', password: legacyPassword } });
  assert.equal(again.status, 200);
  db.close();
});

test('headers restringem scripts e enquadramento; HTTPS e origem são validados atrás do proxy', async t => {
  const plain = await site(t);
  const publicPage = await plain.request('/api/catalog', { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.equal(publicPage.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(publicPage.headers.get('x-frame-options'), 'DENY');
  assert.equal(publicPage.headers.get('strict-transport-security'), null);
  const csp = publicPage.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  const pdf = await plain.request('/api/sources/study-1');
  assert.match(pdf.headers.get('content-security-policy'), /frame-ancestors 'none'/);

  const proxied = await site(t, { trustProxy: 1 });
  const secureOrigin = proxied.origin.replace('http:', 'https:');
  for (const invalid of [proxied.origin, `${secureOrigin}/`, `${secureOrigin}?x=1`, `${secureOrigin}#x`, 'null', 'https://user:pass@example.test']) {
    assert.equal((await proxied.register('secure@example.test', password, { 'X-Forwarded-Proto': 'https', Origin: invalid })).status, 403);
  }
  const registered = await proxied.register('secure@example.test', password, { 'X-Forwarded-Proto': 'https', Origin: secureOrigin });
  assert.equal(registered.status, 201);
  assert.match(registered.headers.get('set-cookie'), /Secure/);
  assert.equal(registered.headers.get('strict-transport-security'), 'max-age=31536000');
});

test('uma troca de conta em outra aba não recebe fila nem logout da conta anterior', async t => {
  const { request, register } = await site(t);
  const first = await register('first@example.test');
  const second = await register('second@example.test');
  const header = { 'X-Vereda-Account': first.data.user.id };
  const read = await request('/api/state', { cookie: second.cookie, headers: header });
  assert.equal(read.status, 409);
  assert.equal(read.data.state, undefined);
  assert.equal((await request('/api/state', { method: 'PATCH', cookie: second.cookie, headers: header, body: { completedChapters: { 'genesis:1': true } } })).status, 409);
  assert.equal((await request('/api/auth/logout', { method: 'POST', cookie: second.cookie, headers: header, body: {} })).status, 409);
  assert.equal((await request('/api/session', { cookie: second.cookie })).data.user.id, second.data.user.id);
  const untouched = await request('/api/state', { cookie: second.cookie, headers: { 'X-Vereda-Account': second.data.user.id } });
  assert.equal(untouched.data.revision, 0);
  assert.deepEqual(untouched.data.state.completedChapters, {});
});

test('limitação de login ocorre antes da consulta de cookie forjado no banco', async t => {
  const { request, fault } = await site(t, { rateLimitEnabled: true });
  const cookie = `vereda_session=${'a'.repeat(64)}`;
  for (let index = 0; index < 25; index++) {
    assert.equal((await request('/api/auth/login', { method: 'POST', cookie, body: { email: 'bad@example.test', password: '' } })).status, 400);
  }
  const before = fault.sessionQueries;
  assert.equal(before, 25);
  assert.equal((await request('/api/auth/login', { method: 'POST', cookie, body: { email: 'bad@example.test', password: '' } })).status, 429);
  assert.equal(fault.sessionQueries, before);
});

test('trabalho de senha concorrente é limitado sem criar contas incompletas', async t => {
  const { register, client } = await site(t);
  const results = await Promise.all([register('one@example.test'), register('two@example.test')]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 429]);
  assert.equal((await client.execute('SELECT count(*) AS count FROM users')).rows[0].count, 1);
});

test('falha ao persistir cadastro não emite cookie nem expõe detalhe do banco', async t => {
  const { register, fault, logs, client } = await site(t);
  fault.failWrites = true;
  const failed = await register();
  assert.equal(failed.status, 503);
  assert.equal(failed.cookie, undefined);
  assert.doesNotMatch(JSON.stringify(failed.data), /synthetic-private|NETWORK_FAILURE|database-url/);
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-private|database-url/);
  assert.equal((await client.execute('SELECT count(*) AS count FROM users')).rows[0].count, 0);
  assert.equal((await client.execute('SELECT count(*) AS count FROM sessions')).rows[0].count, 0);
});

test('sessões expiradas, JSON inválido e pedidos grandes não expõem informações privadas', async t => {
  const { register, request, dbPath } = await site(t);
  const account = await register();
  const db = new DatabaseSync(dbPath);
  db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
  db.close();
  assert.equal((await request('/api/session', { cookie: account.cookie })).data.user, null);
  assert.equal((await request('/api/state', { cookie: account.cookie })).status, 401);
  const invalid = await request('/api/auth/login', { method: 'POST', rawBody: '{"private":"not-closed' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.data, { error: 'JSON inválido.' });
  const oversized = await request('/api/auth/login', { method: 'POST', body: { value: 'x'.repeat(513 * 1024) } });
  assert.equal(oversized.status, 413);
  assert.doesNotMatch(JSON.stringify(oversized.data), /xxxx/);
  const malformed = await request('/api/sources/%E0%A4%A');
  assert.equal(malformed.status, 400);
  assert.deepEqual(malformed.data, { error: 'Solicitação inválida.' });
});
