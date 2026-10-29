import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { createDatabase } from './database.mjs';
import { resolveQuizVersion } from './quiz-versions.mjs';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'vereda_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_PREFIX = 'scrypt-v2$';
const PASSWORD_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const LEGACY_PASSWORD_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
// A new hash uses about 128 MiB. Admit one KDF at a time instead of allowing
// an unbounded work queue to exhaust a small hosting instance.
let passwordWorkInFlight = 0;
const STATE_FIELDS = new Set(['completedChapters', 'completedLessons', 'quizAttempts', 'preferences', 'selectedTrailId', 'lastReading']);
const DEFAULT_PREFERENCES = { theme: 'light', fontSize: 18, speechRate: 1 };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function fail(status, message) { throw new HttpError(status, message); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function normalize(value) { return String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase(); }
function bookKey(value) { return normalize(value).replace(/[^a-z0-9]/g, ''); }
function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
async function passwordWork(operation) {
  if (passwordWorkInFlight >= 1) fail(429, 'Há outra solicitação de acesso em andamento. Aguarde um instante e tente novamente.');
  passwordWorkInFlight++;
  try { return await operation(); }
  finally { passwordWorkInFlight--; }
}
function exactOrigin(value) {
  try {
    const origin = new URL(value);
    return ['http:', 'https:'].includes(origin.protocol) && origin.origin === value ? origin.origin : null;
  } catch { return null; }
}
function emptyState() {
  return { completedChapters: {}, completedLessons: {}, quizAttempts: [], preferences: { ...DEFAULT_PREFERENCES }, selectedTrailId: null, lastReading: null };
}

function requiredText(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    fail(400, `${label} deve ter entre ${min} e ${max} caracteres.`);
  }
  return value.trim();
}

function credentials(body, registration = false) {
  if (!isObject(body)) fail(400, 'Envie os dados em formato JSON.');
  const email = requiredText(body.email, 'O e-mail', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Informe um e-mail válido.');
  const passwordLength = typeof body.password === 'string' ? [...body.password].length : 0;
  // Existing accounts may have shorter passwords. Enforce the stronger rule on
  // registration without locking out people who registered before this change.
  if (passwordLength < (registration ? 15 : 1) || passwordLength > 128) {
    fail(400, registration ? 'A senha deve ter entre 15 e 128 caracteres.' : 'Informe uma senha com até 128 caracteres.');
  }
  return { email, password: body.password, ...(registration ? { name: requiredText(body.name, 'O nome', 2, 60) } : {}) };
}

function cookieToken(req) {
  const cookies = (req.get('cookie') || '').split(';');
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split('=');
    if (name === COOKIE_NAME) {
      const value = parts.join('=');
      return /^[a-f0-9]{64}$/.test(value) ? value : null;
    }
  }
  return null;
}

function publicUser(row) { return { id: row.id, name: row.name, email: row.email }; }

/** Create a same-origin HTTP app. The caller owns the listener and must close app.locals.close(). */
export async function createApp({
  dataDir = path.resolve('content'),
  dbPath = path.resolve('var/vereda.sqlite'),
  databaseUrl,
  databaseAuthToken,
  requireRemoteDatabase = false,
  databaseClient,
  databaseRequestTimeoutMs,
  distDir = path.resolve('dist'),
  allowedOrigins = [],
  trustProxy = false,
  secureCookies = false,
  rateLimitEnabled = true,
  logger = console,
} = {}) {
  const bible = JSON.parse(readFileSync(path.join(dataDir, 'bible.json'), 'utf8'));
  const studies = JSON.parse(readFileSync(path.join(dataDir, 'studies.json'), 'utf8'));
  const passages = JSON.parse(readFileSync(path.join(dataDir, 'passages.json'), 'utf8'));
  const bibleQuizFile = path.join(dataDir, 'bible-quizzes.json');
  const bibleQuizzes = existsSync(bibleQuizFile) ? JSON.parse(readFileSync(bibleQuizFile, 'utf8')) : [];
  const booksById = new Map(bible.books.map(book => [book.id, book]));
  const bookAliases = new Map();
  const chapterIds = new Set();
  const lessonIds = new Set(studies.lessons.map(lesson => lesson.id));
  const trailIds = new Set(studies.trails.map(trail => trail.id));
  const quizzesById = new Map([...studies.quizzes, ...bibleQuizzes].map(quiz => [quiz.id, quiz]));
  const searchableVerses = [];
  for (const book of bible.books) {
    for (const alias of [book.id, book.name, book.abbreviation]) bookAliases.set(bookKey(alias), book);
    for (const chapter of book.chapters) {
      chapterIds.add(`${book.id}:${chapter.number}`);
      for (const verse of chapter.verses) {
        searchableVerses.push({ bookId: book.id, bookName: book.name, chapter: chapter.number, verse: verse.number, text: verse.text, normalizedText: normalize(verse.text) });
      }
    }
  }

  const acceptedOrigins = new Set(allowedOrigins.map(origin => {
    const valid = exactOrigin(origin);
    if (!valid) throw new Error('A origem pública configurada é inválida.');
    return valid;
  }));
  const database = await createDatabase({ dbPath, databaseUrl, databaseAuthToken, requireRemoteDatabase, databaseClient, databaseRequestTimeoutMs });
  const dummySalt = randomBytes(16).toString('hex');
  const dummyHash = randomBytes(64);


  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);
  app.locals.close = () => database.close();
  app.locals.databaseMode = database.mode;
  app.locals.data = { bible, studies, passages };
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    res.set('Cross-Origin-Opener-Policy', 'same-origin');
    res.set('Cross-Origin-Resource-Policy', 'same-origin');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!req.is('application/json')) return next(new HttpError(415, 'Envie os dados em formato JSON.'));
      const origin = req.get('origin');
      let acceptedOrigin = !origin;
      if (origin) {
        try {
          const parsed = exactOrigin(origin);
          acceptedOrigin = parsed !== null && (parsed === `${req.protocol}://${req.get('host')}` || acceptedOrigins.has(parsed));
        } catch { acceptedOrigin = false; }
      }
      if (!acceptedOrigin || req.get('sec-fetch-site') === 'cross-site') {
        return next(new HttpError(403, 'Origem da solicitação não permitida.'));
      }
    }
    next();
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 25,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
    skip: () => !rateLimitEnabled,
  });
  const sessionLookupLimiter = rateLimit({
    windowMs: 60 * 1000, limit: 600,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Muitas solicitações. Aguarde um instante e tente novamente.' },
    skip: req => !rateLimitEnabled || !cookieToken(req),
  });
  // Rate-limit authentication before a forged session cookie can cause a
  // database lookup. The lookup limiter also protects other cookie-bearing APIs.
  app.use(['/api/auth/login', '/api/auth/register'], authLimiter);
  app.use('/api', sessionLookupLimiter);
  app.use('/api', express.json({ limit: '512kb', strict: true }));
  app.use('/api', async (req, _res, next) => {
    const token = cookieToken(req);
    const row = token ? await database.getSession(tokenHash(token), Date.now()) : null;
    req.user = row ? publicUser(row) : null;
    req.sessionToken = row ? token : null;
    next();
  });

  const authenticate = (req, _res, next) => req.user ? next() : next(new HttpError(401, 'Entre na sua conta para sincronizar o progresso.'));
  const intendedAccount = (req, _res, next) => {
    const expected = req.get('X-Vereda-Account');
    if (expected !== undefined && expected !== req.user?.id) return next(new HttpError(409, 'A conta desta sessão mudou. Atualize a página.'));
    next();
  };
  const stateLimiter = rateLimit({
    windowMs: 60 * 1000, limit: 240,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Aguarde um instante antes de sincronizar novamente.' },
    skip: () => !rateLimitEnabled,
  });

  function newSession(req, userId) {
    const now = Date.now();
    const token = randomBytes(32).toString('hex');
    return { token, record: { tokenHash: tokenHash(token), userId, expiresAt: now + SESSION_SECONDS * 1000, now, previousTokenHash: req.sessionToken ? tokenHash(req.sessionToken) : null } };
  }
  function sendSessionCookie(req, res, token) {
    res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies || req.secure, maxAge: SESSION_SECONDS * 1000, path: '/' });
  }

  app.get('/api/health', async (_req, res) => {
    await database.ping();
    res.json({ ok: true, service: 'Vereda Bíblica' });
  });
  app.get('/api/session', (req, res) => res.json({ user: req.user }));

  app.post('/api/auth/register', async (req, res) => {
    const { email, password, name } = credentials(req.body, true);
    const salt = randomBytes(16).toString('hex');
    const hash = PASSWORD_PREFIX + (await passwordWork(() => scrypt(password, salt, 64, PASSWORD_OPTIONS))).toString('hex');
    const user = { id: randomUUID(), name, email };
    const session = newSession(req, user.id);
    await database.createAccount({ user, passwordSalt: salt, passwordHash: hash, state: emptyState(), session: session.record });
    // No cookie may be sent before the database confirms the account/session transaction.
    sendSessionCookie(req, res, session.token);
    res.status(201).json({ user });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = credentials(req.body);
    const row = await database.findUser(email);
    const hasSalt = typeof row?.password_salt === 'string' && /^[a-f0-9]{32}$/.test(row.password_salt);
    const salt = hasSalt ? row.password_salt : dummySalt;
    const isCurrent = typeof row?.password_hash === 'string' && /^scrypt-v2\$[a-f0-9]{128}$/.test(row.password_hash);
    const isLegacy = typeof row?.password_hash === 'string' && /^[a-f0-9]{128}$/.test(row.password_hash);
    const { current, legacy } = await passwordWork(async () => ({
      current: await scrypt(password, salt, 64, PASSWORD_OPTIONS),
      legacy: await scrypt(password, salt, 64, LEGACY_PASSWORD_OPTIONS),
    }));
    // Both work factors run for all logins, including unknown accounts, so a
    // shorter legacy hash does not disclose an account through its KDF cost.
    const actual = isLegacy ? legacy : current;
    const expected = hasSalt && (isCurrent || isLegacy) ? Buffer.from(isCurrent ? row.password_hash.slice(PASSWORD_PREFIX.length) : row.password_hash, 'hex') : dummyHash;
    if (!timingSafeEqual(actual, expected) || !row || !hasSalt || (!isCurrent && !isLegacy)) fail(401, 'E-mail ou senha incorretos.');
    if (isLegacy) await database.updatePasswordHash(row.id, row.password_hash, PASSWORD_PREFIX + current.toString('hex'));
    const session = newSession(req, row.id);
    await database.createSession(session.record);
    sendSessionCookie(req, res, session.token);
    res.json({ user: publicUser(row) });
  });

  app.post('/api/auth/logout', intendedAccount, async (req, res) => {
    if (req.sessionToken) await database.removeSession(tokenHash(req.sessionToken));
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: secureCookies || req.secure, path: '/' });
    res.json({ ok: true });
  });

  function validateMap(value, allowed, maxKeys, label) {
    if (!isObject(value) || Object.keys(value).length > maxKeys) fail(400, `${label} inválido.`);
    for (const [key, complete] of Object.entries(value)) {
      if (!allowed.has(key) || typeof complete !== 'boolean') fail(400, `${label} inválido.`);
    }
    return value;
  }

  function validatePatch(body) {
    if (!isObject(body) || !Object.keys(body).length || Object.keys(body).some(key => !STATE_FIELDS.has(key))) fail(400, 'Atualização de progresso inválida.');
    const patch = {};
    if (Object.hasOwn(body, 'completedChapters')) patch.completedChapters = validateMap(body.completedChapters, chapterIds, chapterIds.size, 'Progresso de capítulos');
    if (Object.hasOwn(body, 'completedLessons')) patch.completedLessons = validateMap(body.completedLessons, lessonIds, lessonIds.size, 'Progresso dos estudos');
    if (Object.hasOwn(body, 'preferences')) {
      const preferences = body.preferences;
      if (!isObject(preferences) || Object.keys(preferences).some(key => !Object.hasOwn(DEFAULT_PREFERENCES, key))) fail(400, 'Preferências inválidas.');
      if (Object.hasOwn(preferences, 'theme') && !['light', 'dark'].includes(preferences.theme)) fail(400, 'Tema inválido.');
      if (Object.hasOwn(preferences, 'fontSize') && (!Number.isInteger(preferences.fontSize) || preferences.fontSize < 16 || preferences.fontSize > 28)) fail(400, 'O tamanho da fonte deve ficar entre 16 e 28.');
      if (Object.hasOwn(preferences, 'speechRate') && (typeof preferences.speechRate !== 'number' || !Number.isFinite(preferences.speechRate) || preferences.speechRate < 0.6 || preferences.speechRate > 1.6)) fail(400, 'A velocidade de leitura deve ficar entre 0,6 e 1,6.');
      patch.preferences = preferences;
    }
    if (Object.hasOwn(body, 'selectedTrailId')) {
      if (body.selectedTrailId !== null && !trailIds.has(body.selectedTrailId)) fail(400, 'Trilha inválida.');
      patch.selectedTrailId = body.selectedTrailId;
    }
    if (Object.hasOwn(body, 'lastReading')) {
      const reading = body.lastReading;
      if (reading !== null) {
        if (!isObject(reading) || !Number.isInteger(reading.chapter) || !chapterIds.has(`${reading.bookId}:${reading.chapter}`)) fail(400, 'Referência de leitura inválida.');
        const chapter = booksById.get(reading.bookId).chapters.find(item => item.number === reading.chapter);
        if (reading.verse !== undefined && (!Number.isInteger(reading.verse) || !chapter.verses.some(item => item.number === reading.verse))) fail(400, 'Versículo inválido.');
        patch.lastReading = { bookId: reading.bookId, chapter: reading.chapter, ...(reading.verse !== undefined ? { verse: reading.verse } : {}) };
      } else patch.lastReading = null;
    }
    if (Object.hasOwn(body, 'quizAttempts')) {
      if (!Array.isArray(body.quizAttempts) || body.quizAttempts.length > 500) fail(400, 'Resultados do quiz inválidos.');
      patch.quizAttempts = body.quizAttempts.map(attempt => {
        const quiz = isObject(attempt) && quizzesById.get(attempt.quizId);
        const version = resolveQuizVersion(quiz, attempt);
        if (!version || typeof attempt.id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(attempt.id) || !Number.isInteger(attempt.score) || attempt.score < 0 || attempt.score > attempt.total || typeof attempt.createdAt !== 'string' || !Number.isFinite(Date.parse(attempt.createdAt))) fail(400, 'Resultado de quiz inválido.');
        let answers;
        if (Object.hasOwn(attempt, 'answers')) {
          if (!Array.isArray(attempt.answers) || attempt.answers.length !== version.questions.length || attempt.answers.some((answer, index) => !Number.isInteger(answer) || answer < 0 || answer >= version.questions[index].choices.length)) fail(400, 'Respostas do quiz inválidas.');
          const score = attempt.answers.reduce((total, answer, index) => total + Number(answer === version.questions[index].answerIndex), 0);
          if (score !== attempt.score) fail(400, 'A pontuação não corresponde às respostas do quiz.');
          answers = [...attempt.answers];
        }
        return { id: attempt.id, quizId: quiz.id, quizRevision: version.revision, score: attempt.score, total: attempt.total, createdAt: new Date(attempt.createdAt).toISOString(), ...(answers ? { answers } : {}) };
      });
    }
    return patch;
  }

  app.get('/api/state', authenticate, intendedAccount, async (req, res) => res.json(await database.readState(req.user.id)));
  app.patch('/api/state', authenticate, intendedAccount, stateLimiter, async (req, res) => {
    const patch = validatePatch(req.body);
    const result = await database.updateState(req.user.id, state => {
      if (patch.completedChapters) state.completedChapters = { ...state.completedChapters, ...patch.completedChapters };
      if (patch.completedLessons) state.completedLessons = { ...state.completedLessons, ...patch.completedLessons };
      if (patch.preferences) state.preferences = { ...state.preferences, ...patch.preferences };
      if (Object.hasOwn(patch, 'selectedTrailId')) state.selectedTrailId = patch.selectedTrailId;
      if (Object.hasOwn(patch, 'lastReading')) state.lastReading = patch.lastReading;
      if (patch.quizAttempts) {
        const attempts = new Map(state.quizAttempts.map(item => [item.id, item]));
        for (const attempt of patch.quizAttempts) if (!attempts.has(attempt.id)) attempts.set(attempt.id, attempt);
        state.quizAttempts = [...attempts.values()].slice(-500);
      }
      return state;
    });
    res.json(result);
  });

  app.get('/api/catalog', (_req, res) => {
    res.json({
      version: bible.version,
      books: bible.books.map(book => ({ id: book.id, name: book.name, abbreviation: book.abbreviation, testament: book.testament, chapterCount: book.chapters.length })),
      studies,
      passages,
      bibleQuizzes,
    });
  });

  app.get('/api/bible/:bookId/:chapter', (req, res) => {
    const book = booksById.get(req.params.bookId);
    const chapterNumber = /^\d{1,3}$/.test(req.params.chapter) ? Number(req.params.chapter) : NaN;
    const chapter = book?.chapters.find(item => item.number === chapterNumber);
    if (!book || !chapter) fail(404, 'Livro ou capítulo não encontrado.');
    res.json({ book: { id: book.id, name: book.name, testament: book.testament }, chapter });
  });

  app.get('/api/search', (req, res) => {
    if (typeof req.query.q !== 'string') fail(400, 'Informe uma referência ou palavra para pesquisar.');
    const query = req.query.q.trim();
    if (query.length < 2 || query.length > 160) fail(400, 'A pesquisa deve ter entre 2 e 160 caracteres.');
    const reference = query.match(/^(.+?)\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)?$/);
    let matches;
    let kind = 'text';
    if (reference) {
      kind = 'reference';
      const book = bookAliases.get(bookKey(reference[1]));
      const chapterNumber = Number(reference[2]);
      const start = reference[3] ? Number(reference[3]) : null;
      const end = reference[4] ? Number(reference[4]) : start;
      const chapter = book?.chapters.find(item => item.number === chapterNumber);
      matches = chapter ? chapter.verses.filter(verse => start === null || (verse.number >= start && verse.number <= end)).map(verse => ({ bookId: book.id, bookName: book.name, chapter: chapter.number, verse: verse.number, text: verse.text })) : [];
    } else {
      const term = normalize(query);
      matches = [];
      for (const verse of searchableVerses) {
        if (verse.normalizedText.includes(term)) {
          const { normalizedText: _normalized, ...result } = verse;
          matches.push(result);
          if (matches.length === 51) break;
        }
      }
    }
    res.json({ query, kind, results: matches.slice(0, 50), truncated: matches.length > 50 });
  });

  const sourceFiles = new Map([['at', 'at.pdf'], ['nt', 'nt.pdf'], ['study-1', 'study-1.pdf'], ['study-2', 'study-2.pdf'], ['study-3', 'study-3.pdf'], ['study-4', 'study-4.pdf'], ['gospels', 'gospels.pdf']]);
  app.get('/api/sources/:id', (req, res, next) => {
    const filename = sourceFiles.get(req.params.id);
    const sourcePath = filename && path.resolve(dataDir, 'source-pdfs', filename);
    if (!sourcePath || !existsSync(sourcePath)) return next(new HttpError(404, 'PDF de consulta não encontrado.'));
    res.set('Content-Type', 'application/pdf');
    // Native PDF viewers may load internal resources; keep the document's
    // anti-framing protection without applying the HTML script/resource policy.
    res.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'none'");
    res.set('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(sourcePath, error => { if (error) next(error); });
  });

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endereço não encontrado.')));
  if (existsSync(path.join(distDir, 'index.html'))) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    if (status >= 500) logger.error('Falha interna no servidor Vereda Bíblica:', error.code === 'DATABASE_UNAVAILABLE' ? 'DATABASE_UNAVAILABLE' : 'REQUEST_FAILED');
    const message = status >= 500 ? 'Não foi possível concluir a solicitação. Tente novamente.'
      : error.type === 'entity.parse.failed' ? 'JSON inválido.'
      : error.type === 'entity.too.large' ? 'Os dados enviados excedem o tamanho permitido.'
      : error instanceof HttpError || error.code === 'EMAIL_CONFLICT' ? error.message
      : status === 404 ? 'Endereço não encontrado.' : 'Solicitação inválida.';
    res.status(status).json({ error: message });
  });
  return app;
}
