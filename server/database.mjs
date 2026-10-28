import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export class DatabaseUnavailableError extends Error {
  constructor() {
    super('O banco de dados está temporariamente indisponível. Tente novamente.');
    this.code = 'DATABASE_UNAVAILABLE';
    this.status = 503;
  }
}

export class EmailConflictError extends Error {
  constructor() {
    super('Não foi possível criar a conta com este e-mail. Se já possui uma conta, tente entrar.');
    this.code = 'EMAIL_CONFLICT';
    this.status = 409;
  }
}

export const DEFAULT_DATABASE_REQUEST_TIMEOUT_MS = 10_000;
const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_MS = 5 * 60 * 1000;
const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const localGates = new Map();

class OperationGate {
  constructor(limit, queueLimit, timeoutMs) { this.limit = limit; this.queueLimit = queueLimit; this.timeoutMs = timeoutMs; this.active = 0; this.waiting = []; }
  async run(operation) {
    if (this.active >= this.limit) {
      if (this.waiting.length >= this.queueLimit) throw new DatabaseUnavailableError();
      await new Promise((resolve, reject) => {
        const entry = { resolve, timer: null };
        entry.timer = setTimeout(() => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new DatabaseUnavailableError());
        }, this.timeoutMs);
        this.waiting.push(entry);
      });
    } else this.active += 1;
    try { return await operation(); }
    finally {
      const next = this.waiting.shift();
      if (next) { clearTimeout(next.timer); next.resolve(); }
      else this.active -= 1;
    }
  }
}

function acquireGate(config, timeoutMs) {
  if (config.mode !== 'local' || config.url === 'file::memory:') return { gate: new OperationGate(config.mode === 'local' ? 1 : 20, config.mode === 'local' ? 40 : 0, timeoutMs), release() {} };
  let entry = localGates.get(config.url);
  if (!entry) { entry = { gate: new OperationGate(1, 40, timeoutMs), references: 0 }; localGates.set(config.url, entry); }
  entry.references += 1;
  return { gate: entry.gate, release() { entry.references -= 1; if (!entry.references && !entry.gate.active && !entry.gate.waiting.length) localGates.delete(config.url); } };
}

export function databaseRequestTimeout(value = DEFAULT_DATABASE_REQUEST_TIMEOUT_MS) {
  if (!Number.isInteger(value) || value < 250 || value > 30_000) {
    throw new Error('O prazo das requisições ao banco deve ficar entre 250 e 30000 milissegundos.');
  }
  return value;
}

/** Keep the signal alive after headers: hrana consumes JSON/cursor bodies later. */
export function createDatabaseFetch({ timeoutMs = DEFAULT_DATABASE_REQUEST_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  databaseRequestTimeout(timeoutMs);
  return (input, init) => {
    const request = new Request(input, init);
    return fetchImpl(request, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]) });
  };
}

const schema = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, last_seen_at INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)',
  `CREATE TABLE IF NOT EXISTS user_states (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
  )`,
];

/** Validate before opening anything; hosted services must never fall back to ephemeral storage. */
export function databaseConfiguration({ dbPath = path.resolve('var/vereda.sqlite'), databaseUrl, databaseAuthToken, requireRemoteDatabase = false } = {}) {
  if (databaseUrl !== undefined && (typeof databaseUrl !== 'string' || !databaseUrl.trim())) throw new Error('DATABASE_URL deve conter um endereço de banco válido.');
  if (databaseAuthToken !== undefined && (typeof databaseAuthToken !== 'string' || !databaseAuthToken.trim())) throw new Error('DATABASE_AUTH_TOKEN deve conter um token válido.');
  if (!databaseUrl && (requireRemoteDatabase || databaseAuthToken)) throw new Error('Configure DATABASE_URL e DATABASE_AUTH_TOKEN para usar um banco remoto persistente.');
  let parsed;
  if (databaseUrl) {
    try { parsed = new URL(databaseUrl); }
    catch { throw new Error('DATABASE_URL deve conter um endereço de banco válido.'); }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('DATABASE_URL não pode conter credenciais, parâmetros ou fragmentos.');
    if (parsed.protocol === 'file:') {
      if (requireRemoteDatabase) throw new Error('Esta hospedagem exige banco remoto persistente; um arquivo local não pode ser utilizado.');
      if (databaseAuthToken) throw new Error('Não informe DATABASE_AUTH_TOKEN para um banco local.');
      if (parsed.hostname && parsed.hostname !== 'localhost') throw new Error('O endereço do banco local é inválido.');
      return { mode: 'local', url: parsed.href };
    }
    if (!['https:', 'libsql:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('O banco remoto precisa usar HTTPS ou libsql com TLS.');
    if (!databaseAuthToken) throw new Error('Configure DATABASE_AUTH_TOKEN para acessar o banco remoto.');
    return { mode: 'remote', url: parsed.href, authToken: databaseAuthToken };
  }
  if (dbPath === ':memory:') return { mode: 'local', url: 'file::memory:' };
  return { mode: 'local', url: pathToFileURL(path.resolve(dbPath)).href };
}

function busy(error) { return /(?:SQLITE_BUSY|SQLITE_LOCKED)/.test(String(error?.code || '')); }
async function retryLock(operation, resetAfterBusy = async () => {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      // Only retry a failed lock acquisition or an atomic batch rolled back by the SDK.
      if (!busy(error) || attempt >= 8) throw error;
      await resetAfterBusy();
      await new Promise(resolve => setTimeout(resolve, Math.min(15 * 2 ** attempt, 180)));
    }
  }
}

function stateFromRow(row) {
  if (!row) throw new DatabaseUnavailableError();
  return { state: JSON.parse(row.state_json), revision: Number(row.revision) };
}

export async function createDatabase(options = {}) {
  const config = databaseConfiguration(options);
  const requestTimeoutMs = databaseRequestTimeout(options.databaseRequestTimeoutMs);
  const { gate, release } = acquireGate(config, requestTimeoutMs);
  let client;
  const resetAfterBusy = async () => {
    if (config.mode === 'local' && !options.databaseClient && client) {
      // A failed BEGIN in the native SDK can leave a prepared statement active.
      // The gate guarantees there is no other operation using this connection.
      await client.reconnect();
      await client.execute('PRAGMA foreign_keys = ON');
    }
  };
  try {
    await gate.run(async () => {
    if (!options.databaseClient && config.mode === 'local' && config.url !== 'file::memory:') mkdirSync(path.dirname(fileURLToPath(config.url)), { recursive: true });
    client = options.databaseClient || await retryLock(() => createClient({
      url: config.url,
      ...(config.authToken ? { authToken: config.authToken, tls: true } : {}),
      intMode: 'number',
      concurrency: config.mode === 'local' ? 1 : 20,
      fetch: createDatabaseFetch({ timeoutMs: requestTimeoutMs }),
      // A synchronous busy wait in the native file driver would block another request's commit.
      // Retry lock acquisition asynchronously instead; remote transactions wait on the server.
      timeout: 0,
    }));
    const initializeExecute = statement => retryLock(() => client.execute(statement), resetAfterBusy);
    if (config.mode === 'local') await initializeExecute('PRAGMA journal_mode = WAL');
    await initializeExecute('PRAGMA foreign_keys = ON');
    await retryLock(() => client.batch(schema, 'write'), resetAfterBusy);
    // Existing SQLite files remain usable. This changes only session metadata,
    // never accounts or progress, and limits the old 30-day sessions to 7 days.
    let sessionColumns = await initializeExecute('PRAGMA table_info(sessions)');
    if (!sessionColumns.rows.some(column => column.name === 'last_seen_at')) {
      try { await initializeExecute('ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER'); }
      catch (error) {
        // Another starting instance may have completed the same additive migration.
        sessionColumns = await initializeExecute('PRAGMA table_info(sessions)');
        if (!sessionColumns.rows.some(column => column.name === 'last_seen_at')) throw error;
      }
    }
    const migrationTime = Date.now();
    await initializeExecute({ sql: 'UPDATE sessions SET last_seen_at = ?, expires_at = MIN(expires_at, ?) WHERE last_seen_at IS NULL', args: [migrationTime, migrationTime + SESSION_MAX_MS] });
    });
  } catch (error) {
    try { client?.close(); } catch { /* Do not mask the failure or expose SDK connection details. */ }
    release();
    throw new DatabaseUnavailableError();
  }

  const execute = async statement => {
    try { return await retryLock(() => client.execute(statement), resetAfterBusy); }
    catch { throw new DatabaseUnavailableError(); }
  };
  const batch = async statements => retryLock(() => client.batch(statements, 'write'), resetAfterBusy);
  const sessionStatements = ({ tokenHash, userId, expiresAt, previousTokenHash, now }) => [
    { sql: 'DELETE FROM sessions WHERE expires_at <= ?', args: [now] },
    ...(previousTokenHash ? [{ sql: 'DELETE FROM sessions WHERE token_hash = ?', args: [previousTokenHash] }] : []),
    { sql: 'INSERT INTO sessions(token_hash, user_id, expires_at, last_seen_at) VALUES (?, ?, ?, ?)', args: [tokenHash, userId, Math.min(expiresAt, now + SESSION_MAX_MS), now] },
  ];

  let closed = false;
  const repository = {
    mode: config.mode,
    close() { if (closed) return; closed = true; client.close(); release(); },
    async ping() { await execute('SELECT 1 AS ready'); },
    async getSession(tokenHash, now) {
      const result = await execute({ sql: 'SELECT users.id, users.name, users.email, sessions.last_seen_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ? AND last_seen_at > ?', args: [tokenHash, now, now - SESSION_IDLE_MS] });
      const row = result.rows[0];
      if (!row) return null;
      if (Number(row.last_seen_at) <= now - SESSION_TOUCH_MS) {
        await execute({ sql: 'UPDATE sessions SET last_seen_at = ? WHERE token_hash = ? AND expires_at > ? AND last_seen_at > ? AND last_seen_at <= ?', args: [now, tokenHash, now, now - SESSION_IDLE_MS, now - SESSION_TOUCH_MS] });
      }
      return { id: row.id, name: row.name, email: row.email };
    },
    async findUser(email) {
      const result = await execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
      return result.rows[0] || null;
    },
    async updatePasswordHash(userId, previousHash, newHash) {
      const result = await execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?', args: [newHash, userId, previousHash] });
      return Number(result.rowsAffected) === 1;
    },
    async createAccount({ user, passwordSalt, passwordHash, state, session }) {
      try {
        await batch([
          { sql: 'INSERT INTO users(id, name, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)', args: [user.id, user.name, user.email, passwordSalt, passwordHash, session.now] },
          { sql: 'INSERT INTO user_states(user_id, state_json, revision, updated_at) VALUES (?, ?, 0, ?)', args: [user.id, JSON.stringify(state), session.now] },
          ...sessionStatements(session),
        ]);
      } catch (error) {
        if (/CONSTRAINT/.test(String(error?.code || '')) && String(error?.message).includes('users.email')) throw new EmailConflictError();
        throw new DatabaseUnavailableError();
      }
    },
    async createSession(session) {
      try { await batch(sessionStatements(session)); }
      catch { throw new DatabaseUnavailableError(); }
    },
    async removeSession(tokenHash) { await execute({ sql: 'DELETE FROM sessions WHERE token_hash = ?', args: [tokenHash] }); },
    async readState(userId) {
      const result = await execute({ sql: 'SELECT state_json, revision FROM user_states WHERE user_id = ?', args: [userId] });
      return stateFromRow(result.rows[0]);
    },
    async updateState(userId, merge) {
      let transaction;
      try {
        transaction = await retryLock(() => client.transaction('write'), resetAfterBusy);
        const row = (await transaction.execute({ sql: 'SELECT state_json, revision FROM user_states WHERE user_id = ?', args: [userId] })).rows[0];
        const { state } = stateFromRow(row);
        const updated = merge(state);
        await transaction.execute({ sql: 'UPDATE user_states SET state_json = ?, revision = revision + 1, updated_at = ? WHERE user_id = ?', args: [JSON.stringify(updated), Date.now(), userId] });
        const result = stateFromRow((await transaction.execute({ sql: 'SELECT state_json, revision FROM user_states WHERE user_id = ?', args: [userId] })).rows[0]);
        await transaction.commit();
        return result;
      } catch {
        try { if (transaction && !transaction.closed) await transaction.rollback(); } catch { /* The original result remains a sanitized unavailable error. */ }
        throw new DatabaseUnavailableError();
      } finally { try { transaction?.close(); } catch { /* Best-effort resource cleanup. */ } }
    },
  };
  // Admission is bounded before entering the SDK's own queue. A remote outage
  // cannot accumulate an unlimited number of pending operations in this client.
  for (const [name, method] of Object.entries(repository)) {
    if (typeof method === 'function' && name !== 'close') repository[name] = (...args) => {
      if (closed) return Promise.reject(new DatabaseUnavailableError());
      return gate.run(() => { if (closed) throw new DatabaseUnavailableError(); return method(...args); });
    };
  }
  return repository;
}
