import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';
import { createDatabase, databaseConfiguration, createDatabaseFetch, databaseRequestTimeout } from '../server/database.mjs';
import { createApp } from '../server/app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const initialState = () => ({ completedChapters: {}, completedLessons: {}, quizAttempts: [], preferences: { theme: 'light', fontSize: 18, speechRate: 1 }, selectedTrailId: null, lastReading: null });
const account = (id, email = `${id}@example.test`, now = Date.now()) => ({ user: { id, email, name: 'Leitora temporária' }, passwordSalt: 'fixture-salt', passwordHash: 'fixture-hash', state: initialState(), session: { tokenHash: `hash-${id}`, userId: id, expiresAt: now + 30 * 86400000, now } });
function temporary(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'vereda-database-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('configuração hospedada exige TLS e token e nunca abre arquivo local como fallback', async t => {
  const directory = temporary(t);
  const dbPath = path.join(directory, 'must-not-exist.sqlite');
  const invalid = [
    { requireRemoteDatabase: true },
    { databaseAuthToken: 'test-only-token' },
    { databaseUrl: '' },
    { databaseUrl: 'file:/tmp/fixture.sqlite', requireRemoteDatabase: true },
    { databaseUrl: 'https://database.invalid' },
    { databaseUrl: 'http://database.invalid', databaseAuthToken: 'test-only-token' },
    { databaseUrl: 'libsql://database.invalid?tls=0', databaseAuthToken: 'test-only-token' },
    { databaseUrl: 'https://person:password@database.invalid', databaseAuthToken: 'test-only-token' },
    { databaseUrl: 'https://database.invalid#credential', databaseAuthToken: 'test-only-token' },
    { databaseUrl: 'https://database.invalid', databaseAuthToken: ' ' },
  ];
  for (const options of invalid) await assert.rejects(createDatabase({ dbPath, ...options }));
  assert.equal(existsSync(dbPath), false);
  assert.equal(databaseConfiguration({ databaseUrl: 'libsql://database.invalid', databaseAuthToken: 'test-only-token', requireRemoteDatabase: true }).mode, 'remote');
  for (const value of [0, 249, 30001, NaN, Infinity, '1000']) assert.throws(() => databaseRequestTimeout(value));
});

test('duas instâncias aplicam alterações concorrentes sem perder campos de progresso', async t => {
  const directory = temporary(t);
  const dbPath = path.join(directory, 'state.sqlite');
  const first = await createDatabase({ dbPath });
  const second = await createDatabase({ dbPath });
  t.after(() => { first.close(); second.close(); });
  await first.createAccount(account('concurrent'));
  await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? first : second).updateState('concurrent', state => ({ ...state, completedChapters: { ...state.completedChapters, [`genesis:${index + 1}`]: true } }))));
  const result = await second.readState('concurrent');
  assert.equal(result.revision, 12);
  assert.equal(Object.keys(result.state.completedChapters).length, 12);
  assert.ok(Object.values(result.state.completedChapters).every(Boolean));
  first.close(); second.close();
  const restored = await createDatabase({ dbPath });
  t.after(() => restored.close());
  assert.deepEqual((await restored.readState('concurrent')).state, result.state);
});

test('conflito de cadastro faz rollback da conta, progresso e sessão da tentativa rejeitada', async t => {
  const directory = temporary(t);
  const db = await createDatabase({ dbPath: path.join(directory, 'state.sqlite') });
  t.after(() => db.close());
  await db.createAccount(account('original', 'same@example.test'));
  await assert.rejects(db.createAccount(account('rejected', 'same@example.test')), error => error.status === 409);
  assert.equal((await db.findUser('same@example.test')).id, 'original');
  assert.equal(await db.getSession('hash-rejected', Date.now()), null);
  await assert.rejects(db.readState('rejected'), error => error.status === 503);
  assert.equal((await db.readState('original')).revision, 0);
});

test('processos separados preservam atualizações no mesmo SQLite', async t => {
  const directory = temporary(t);
  const dbPath = path.join(directory, 'multi-process.sqlite');
  const db = await createDatabase({ dbPath }); t.after(() => db.close());
  await db.createAccount(account('multi-process'));
  const source = `import {createDatabase} from ${JSON.stringify(new URL('../server/database.mjs', import.meta.url).href)};
    const db=await createDatabase({databaseUrl:process.argv[1]});
    try{for(let i=0;i<4;i++)await db.updateState('multi-process',state=>({...state,completedChapters:{...state.completedChapters,[process.argv[2]+i]:true}}));}
    finally{db.close();}`;
  const run = prefix => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, pathToFileURL(dbPath).href, prefix], { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.setEncoding('utf8'); child.stderr.on('data', data => { error += data; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Processo de teste excedeu o prazo.')); }, 8000);
    child.once('error', cause => { clearTimeout(timer); reject(cause); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Processo de teste falhou: ${error}`)); });
  });
  await Promise.all(['a', 'b', 'c'].map(run));
  const result = await db.readState('multi-process');
  assert.equal(result.revision, 12);
  assert.equal(Object.keys(result.state.completedChapters).length, 12);
});

test('admissão remota rejeita excesso sem formar fila ilimitada', async t => {
  const directory = temporary(t);
  const client = createClient({ url: pathToFileURL(path.join(directory, 'gate.sqlite')).href });
  const release = [];
  let hold = false;
  const injected = {
    execute: statement => hold ? new Promise(resolve => release.push(() => resolve({ rows: [{ ready: 1 }] }))) : client.execute(statement),
    batch: (...args) => client.batch(...args),
    transaction: (...args) => client.transaction(...args),
    close: () => client.close(),
  };
  const db = await createDatabase({ databaseUrl: 'https://integration.invalid', databaseAuthToken: 'test-only-token', databaseClient: injected, requireRemoteDatabase: true });
  t.after(() => db.close());
  hold = true;
  const active = Array.from({ length: 20 }, () => db.ping());
  try { await assert.rejects(db.ping(), error => error.status === 503); }
  finally { hold = false; release.forEach(resolve => resolve()); await Promise.all(active); }
  await db.ping();
});

test('sessões expiram por inatividade e duração absoluta e hashes usam atualização condicional', async t => {
  const directory = temporary(t);
  const db = await createDatabase({ dbPath: path.join(directory, 'state.sqlite') });
  t.after(() => db.close());
  const now = Date.now();
  await db.createAccount(account('idle', undefined, now));
  assert.equal((await db.getSession('hash-idle', now + 1000)).id, 'idle');
  assert.equal(await db.getSession('hash-idle', now + 86400000), null);
  await db.createSession({ tokenHash: 'hash-active', userId: 'idle', expiresAt: now + 30 * 86400000, now });
  for (let day = 1; day <= 6; day++) assert.ok(await db.getSession('hash-active', now + day * 86400000 - day * 1000));
  assert.equal(await db.getSession('hash-active', now + 7 * 86400000), null);
  assert.equal(await db.updatePasswordHash('idle', 'fixture-hash', 'upgraded-hash'), true);
  assert.equal(await db.updatePasswordHash('idle', 'fixture-hash', 'stale-replacement'), false);
  assert.equal((await db.findUser('idle@example.test')).password_hash, 'upgraded-hash');
});

test('migração de SQLite anterior preserva contas e progresso e limita sessões antigas', async t => {
  const directory = temporary(t);
  const dbPath = path.join(directory, 'legacy.sqlite');
  const old = new DatabaseSync(dbPath);
  old.exec('CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,password_salt TEXT,password_hash TEXT,created_at INTEGER); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER); CREATE TABLE user_states(user_id TEXT PRIMARY KEY,state_json TEXT,revision INTEGER,updated_at INTEGER)');
  const now = Date.now();
  const state = initialState(); state.completedChapters['genesis:1'] = true;
  old.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('legacy', 'Leitora', 'legacy@example.test', 'salt', 'old-hash', now);
  old.prepare('INSERT INTO sessions VALUES(?,?,?)').run('legacy-session', 'legacy', now + 30 * 86400000);
  old.prepare('INSERT INTO user_states VALUES(?,?,?,?)').run('legacy', JSON.stringify(state), 4, now);
  old.close();
  const db = await createDatabase({ dbPath }); t.after(() => db.close());
  assert.equal((await db.findUser('legacy@example.test')).password_hash, 'old-hash');
  assert.deepEqual((await db.readState('legacy')).state, state);
  assert.equal((await db.readState('legacy')).revision, 4);
  assert.equal((await db.getSession('legacy-session', Date.now())).id, 'legacy');
  assert.equal(await db.getSession('legacy-session', Date.now() + 8 * 86400000), null);
});

test('timeout cancela corpo HTTP pendurado e sanitiza erro sem fallback local', async t => {
  const directory = temporary(t);
  let disconnected = false;
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.flushHeaders();
    response.write('{');
    response.on('close', () => { disconnected = true; });
  });
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const client = createClient({ url: `http://127.0.0.1:${server.address().port}`, fetch: createDatabaseFetch({ timeoutMs: 250 }) });
  const dbPath = path.join(directory, 'no-fallback.sqlite');
  const started = Date.now();
  await assert.rejects(createDatabase({ dbPath, databaseUrl: 'https://integration.invalid', databaseAuthToken: 'test-only-token', requireRemoteDatabase: true, databaseClient: client }), error => error.status === 503 && !error.message.includes('integration.invalid') && !error.message.includes('test-only-token'));
  assert.ok(Date.now() - started < 2000, 'O corpo HTTP deve ser cancelado pelo prazo.');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(disconnected, true, 'A conexão HTTP deve ser cancelada, não apenas abandonada por Promise.race.');
  assert.equal(existsSync(dbPath), false);
});

test('falha ao persistir cadastro não emite cookie nem expõe detalhes do SDK', async t => {
  const directory = temporary(t);
  const client = createClient({ url: pathToFileURL(path.join(directory, 'isolated.sqlite')).href });
  let unavailable = false;
  const failingClient = {
    execute: (...args) => client.execute(...args),
    batch: (...args) => { if (unavailable) throw new Error('sdk-details: test-only-sensitive-marker'); return client.batch(...args); },
    transaction: (...args) => client.transaction(...args),
    close: () => client.close(),
  };
  const logs = [];
  const app = await createApp({ dataDir: path.join(root, 'content'), distDir: path.join(directory, 'no-dist'), databaseUrl: 'https://integration.invalid', databaseAuthToken: 'test-only-token', databaseClient: failingClient, requireRemoteDatabase: true, rateLimitEnabled: false, logger: { error: (...args) => logs.push(args.join(' ')) } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await app.locals.close(); });
  unavailable = true;
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Leitora', email: 'failure@example.test', password: 'test-password-not-real-2026' }) });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
  const body = JSON.stringify(await response.json());
  assert.ok(!body.includes('test-only-sensitive-marker'));
  assert.ok(logs.every(message => !message.includes('test-only-sensitive-marker')));
  assert.equal((await client.execute('SELECT count(*) AS n FROM users')).rows[0].n, 0);
});
