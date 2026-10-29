import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.mjs';

const fixtures = {
  bible: { version: 'NVI: teste', books: [
    { id: 'genesis', name: 'Gênesis', abbreviation: 'Gn', testament: 'AT', chapters: [
      { number: 1, verses: [{ number: 1, text: 'No princípio Deus criou os céus e a terra.' }, { number: 2, text: 'Era a terra sem forma e vazia.' }], sourcePages: [1] },
      { number: 2, verses: [{ number: 1, text: 'Assim foram concluídos os céus e a terra.' }], sourcePages: [2] },
    ] },
    { id: 'joao', name: 'João', abbreviation: 'Jo', testament: 'NT', chapters: [
      { number: 3, verses: [{ number: 16, text: 'Porque Deus tanto amou o mundo.' }, { number: 17, text: 'Deus enviou o seu Filho ao mundo.' }], sourcePages: [98] },
    ] },
  ] },
  studies: {
    sources: [{ id: 'study-1', title: 'Introdução', file: 'study-1.pdf', totalPages: 15 }],
    trails: [{ id: 'comecar', title: 'Comece aqui', description: 'Introdução', lessonIds: ['organizacao'], recommended: true }],
    lessons: [{ id: 'organizacao', title: 'Organização', trailId: 'comecar', description: '', sourceId: 'study-1', startPage: 5, endPage: 6, sections: [] }],
    quizzes: [{ id: 'quiz-organizacao', lessonId: 'organizacao', title: 'Organização', questions: [{ id: 'q1', prompt: 'Pergunta do teste', choices: ['A', 'B'], answerIndex: 0, explanation: '', source: { sourceId: 'study-1', page: 5 } }] }],
  },
  passages: [{ id: 'p1', bookId: 'joao', bookName: 'João', chapter: 3, verseStart: 16, verseEnd: 16, text: 'Porque Deus tanto amou o mundo.' }],
};

async function fixture(t, extra = {}, contentOverrides = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'vereda-api-'));
  mkdirSync(path.join(directory, 'source-pdfs'));
  for (const [file, value] of Object.entries({ ...fixtures, ...contentOverrides })) writeFileSync(path.join(directory, `${file}.json`), JSON.stringify(value));
  writeFileSync(path.join(directory, 'source-pdfs', 'study-1.pdf'), '%PDF-1.4\n% fixture');
  const dbPath = path.join(directory, 'state.sqlite');
  const app = await createApp({ dataDir: directory, dbPath, distDir: path.join(directory, 'no-dist'), rateLimitEnabled: false, logger: { error() {} }, ...extra });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, { method = 'GET', body, cookie, headers = {} } = {}) => {
    const response = await fetch(`${origin}${route}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, headers: response.headers, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await app.locals.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { request, origin, dbPath, app };
}

async function register(request, email = 'leitor@example.test') {
  const response = await request('/api/auth/register', { method: 'POST', body: { name: 'Leitor Teste', email, password: 'senha-de-teste-123' } });
  assert.equal(response.status, 201);
  assert.ok(response.cookie);
  return response;
}

test('quizzes bíblicos sincronizam resultados e versões antigas mantêm seu próprio gabarito', async t => {
  const original = fixtures.studies.quizzes[0];
  const oldQuestion = original.questions[0];
  const current = { ...original, revision: 2,
    questions: [oldQuestion, { ...oldQuestion, id: 'q2', answerIndex: 1 }, { ...oldQuestion, id: 'q3' }],
    previousVersions: [{ revision: 1, questions: [oldQuestion] }],
  };
  const bibleQuiz = { id: 'quiz-biblia-teste', category: 'bible', revision: 1, difficulty: 'easy', title: 'Quiz da Bíblia',
    questions: [{ ...oldQuestion, id: 'b1', answerIndex: 1 }, { ...oldQuestion, id: 'b2' }],
  };
  const { request } = await fixture(t, {}, {
    studies: { ...fixtures.studies, quizzes: [current] },
    'bible-quizzes': [bibleQuiz],
  });
  const catalog = await request('/api/catalog');
  assert.equal(catalog.data.bibleQuizzes[0].id, bibleQuiz.id);
  const account = await register(request);
  const common = { createdAt: '2026-10-28T12:00:00Z' };
  const attempts = [
    { ...common, id: 'old-client-attempt', quizId: original.id, total: 1, score: 1, answers: [0] },
    { ...common, id: 'current-attempt', quizId: original.id, quizRevision: 2, total: 3, score: 3, answers: [0, 1, 0] },
    { ...common, id: 'bible-attempt', quizId: bibleQuiz.id, quizRevision: 1, total: 2, score: 2, answers: [1, 0] },
  ];
  const saved = await request('/api/state', { method: 'PATCH', cookie: account.cookie, body: { quizAttempts: attempts } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.state.quizAttempts.map(attempt => attempt.quizRevision), [1, 2, 1]);
  assert.deepEqual(saved.data.state.quizAttempts[0].answers, [0]);
  for (const invalid of [
    { ...attempts[1], quizRevision: 1 },
    { ...attempts[0], quizRevision: 2 },
    { ...attempts[2], answers: [0, 0] },
    { ...attempts[2], quizRevision: 99 },
  ]) {
    const rejected = await request('/api/state', { method: 'PATCH', cookie: account.cookie, body: { quizAttempts: [{ ...invalid, id: 'invalid-revision-attempt' }] } });
    assert.equal(rejected.status, 400);
  }
  const retained = await request('/api/state', { cookie: account.cookie });
  assert.equal(retained.data.state.quizAttempts.length, 3);
  assert.deepEqual(retained.data.state.quizAttempts.map(attempt => attempt.total), [1, 3, 2]);
});

test('conteúdo público, capítulos, pesquisa com acentos e fontes ficam acessíveis sem conta', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/api/health')).data.ok, true);
  const catalog = await request('/api/catalog');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.data.books.length, 2);
  assert.equal(catalog.data.books[0].chapterCount, 2);
  assert.equal(catalog.data.studies.trails[0].id, 'comecar');
  assert.equal((await request('/api/bible/genesis/1')).data.chapter.verses[0].number, 1);
  assert.equal((await request('/api/bible/genesis/200')).status, 404);
  const reference = await request('/api/search?q=Jo%C3%A3o%203%3A16');
  assert.equal(reference.data.kind, 'reference');
  assert.deepEqual(reference.data.results.map(item => [item.bookId, item.chapter, item.verse]), [['joao', 3, 16]]);
  assert.equal((await request('/api/search?q=Jo3.16-17')).data.results.length, 2);
  assert.equal((await request('/api/search?q=principio')).data.results[0].bookId, 'genesis');
  assert.equal((await request('/api/search?q=livro%203%3A1')).data.results.length, 0);
  assert.equal((await request('/api/search?q=x')).status, 400);
  assert.equal((await request('/api/search?q%5Bx%5D=y')).status, 400);
  const source = await request('/api/sources/study-1');
  assert.equal(source.status, 200);
  assert.match(source.headers.get('content-type'), /application\/pdf/);
  assert.equal((await request('/api/sources/unknown')).status, 404);
  assert.equal((await request('/api/state')).status, 401);
});

test('cadastro armazena hash, cria sessão protegida, entra novamente e invalida logout', async t => {
  const { request, dbPath } = await fixture(t);
  const created = await register(request);
  const cookieHeader = created.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Lax/);
  assert.doesNotMatch(cookieHeader, /Secure/);
  assert.equal((await request('/api/session', { cookie: created.cookie })).data.user.id, created.data.user.id);
  assert.equal((await request('/api/session')).data.user, null);
  const inspection = new DatabaseSync(dbPath, { readOnly: true });
  const stored = inspection.prepare('SELECT password_hash, password_salt FROM users').get();
  assert.match(stored.password_hash, /^scrypt-v2\$[a-f0-9]{128}$/);
  assert.equal(stored.password_salt.length, 32);
  assert.notEqual(stored.password_hash, 'senha-de-teste-123');
  const sessionRow = inspection.prepare('SELECT token_hash FROM sessions').get();
  assert.notEqual(sessionRow.token_hash, created.cookie.split('=')[1]);
  inspection.close();
  const wrong = await request('/api/auth/login', { method: 'POST', body: { email: 'leitor@example.test', password: 'senha-incorreta' } });
  assert.equal(wrong.status, 401);
  const missing = await request('/api/auth/login', { method: 'POST', body: { email: 'naoexiste@example.test', password: 'senha-incorreta' } });
  assert.equal(missing.status, 401);
  assert.equal(missing.data.error, wrong.data.error);
  assert.equal((await request('/api/auth/register', { method: 'POST', body: { name: 'Nome', email: 'leitor@example.test', password: 'outra-senha-de-teste-123' } })).status, 409);
  const loggedIn = await request('/api/auth/login', { method: 'POST', body: { email: 'LEITOR@example.test', password: 'senha-de-teste-123' } });
  assert.equal(loggedIn.status, 200);
  assert.notEqual(loggedIn.cookie, created.cookie);
  assert.equal((await request('/api/auth/logout', { method: 'POST', body: {}, cookie: loggedIn.cookie })).status, 200);
  assert.equal((await request('/api/session', { cookie: loggedIn.cookie })).data.user, null);
});

test('duas sessões sincronizam campos independentes, reversão e tentativas sem duplicação', async t => {
  const { request } = await fixture(t);
  const account = await register(request);
  const otherDevice = await request('/api/auth/login', { method: 'POST', body: { email: 'leitor@example.test', password: 'senha-de-teste-123' } });
  const first = await request('/api/state', { method: 'PATCH', cookie: account.cookie, body: { completedChapters: { 'genesis:1': true }, preferences: { theme: 'dark' }, selectedTrailId: 'comecar' } });
  assert.equal(first.status, 200);
  assert.equal(first.data.revision, 1);
  const second = await request('/api/state', { method: 'PATCH', cookie: otherDevice.cookie, body: { completedChapters: { 'genesis:2': true }, completedLessons: { organizacao: true }, preferences: { fontSize: 24 } } });
  assert.equal(second.status, 200);
  assert.equal(second.data.state.completedChapters['genesis:1'], true);
  assert.equal(second.data.state.completedChapters['genesis:2'], true);
  assert.deepEqual(second.data.state.preferences, { theme: 'dark', fontSize: 24, speechRate: 1 });
  const attempt = { id: 'attempt-00001', quizId: 'quiz-organizacao', score: 1, total: 1, createdAt: '2026-10-27T12:00:00Z' };
  for (let index = 0; index < 2; index++) {
    assert.equal((await request('/api/state', { method: 'PATCH', cookie: account.cookie, body: { quizAttempts: [attempt], completedChapters: { 'genesis:1': false }, lastReading: { bookId: 'joao', chapter: 3, verse: 16 } } })).status, 200);
  }
  const fromDevice = await request('/api/state', { cookie: otherDevice.cookie });
  assert.equal(fromDevice.data.state.completedChapters['genesis:1'], false);
  assert.equal(fromDevice.data.state.completedChapters['genesis:2'], true);
  assert.equal(fromDevice.data.state.quizAttempts.length, 1);
  assert.deepEqual(fromDevice.data.state.lastReading, { bookId: 'joao', chapter: 3, verse: 16 });
  assert.equal(fromDevice.data.revision, 4);
});

test('progresso de uma conta nunca aparece em outra e entradas inválidas não mudam o estado', async t => {
  const { request } = await fixture(t);
  const one = await register(request, 'primeira@example.test');
  const two = await register(request, 'segunda@example.test');
  await request('/api/state', { method: 'PATCH', cookie: one.cookie, body: { completedChapters: { 'genesis:1': true } } });
  assert.deepEqual((await request('/api/state', { cookie: two.cookie })).data.state.completedChapters, {});
  const invalid = [
    { completedChapters: { 'genesis:999': true } },
    { completedChapters: { 'genesis:1': 'true' } },
    { completedLessons: { desconhecida: true } },
    { preferences: { theme: 'sepia' } },
    { preferences: { fontSize: 100 } },
    { preferences: { speechRate: 4 } },
    { preferences: { email: 'intruso@example.test' } },
    { lastReading: { bookId: 'joao', chapter: 3, verse: 100 } },
    { selectedTrailId: 'inventada' },
    { quizAttempts: [{ id: 'bad-attempt', quizId: 'quiz-organizacao', total: 2, score: 2, createdAt: new Date().toISOString() }] },
    { userId: one.data.user.id, completedChapters: { 'genesis:1': true } },
    {},
  ];
  for (const body of invalid) assert.equal((await request('/api/state', { method: 'PATCH', cookie: two.cookie, body })).status, 400);
  assert.equal((await request('/api/state', { cookie: two.cookie })).data.revision, 0);
  assert.equal((await request('/api/state', { method: 'PATCH', body: { completedChapters: { 'genesis:1': true } } })).status, 401);
});

test('respostas individuais são sincronizadas e a pontuação precisa corresponder ao gabarito', async t => {
  const { request } = await fixture(t);
  const account = await register(request);
  const attempt = { id: 'answers-00001', quizId: 'quiz-organizacao', score: 0, total: 1, createdAt: '2026-10-27T12:00:00Z', answers: [1] };
  const saved = await request('/api/state', { method: 'PATCH', cookie: account.cookie, body: { quizAttempts: [attempt] } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.state.quizAttempts[0].answers, [1]);
  assert.equal(saved.data.state.quizAttempts[0].score, 0);
  const otherDevice = await request('/api/auth/login', { method: 'POST', body: { email: 'leitor@example.test', password: 'senha-de-teste-123' } });
  assert.deepEqual((await request('/api/state', { cookie: otherDevice.cookie })).data.state.quizAttempts[0].answers, [1]);
  const invalid = [
    { answers: [0], score: 0 },
    { answers: [], score: 0 },
    { answers: [0, 1], score: 1 },
    { answers: [-1], score: 0 },
    { answers: [2], score: 0 },
    { answers: [0.5], score: 0 },
    { answers: ['1'], score: 0 },
    { answers: null, score: 0 },
  ];
  for (const invalidAnswers of invalid) {
    const response = await request('/api/state', { method: 'PATCH', cookie: account.cookie, body: { quizAttempts: [{ ...attempt, id: 'invalid-answer', ...invalidAnswers }] } });
    assert.equal(response.status, 400);
  }
  const unchanged = await request('/api/state', { cookie: account.cookie });
  assert.equal(unchanged.data.revision, 1);
  assert.equal(unchanged.data.state.quizAttempts.length, 1);
  assert.deepEqual(unchanged.data.state.quizAttempts[0].answers, [1]);
  const legacy = { id: 'legacy-attempt', quizId: 'quiz-organizacao', score: 1, total: 1, createdAt: '2026-10-27T11:00:00Z' };
  const acceptedLegacy = await request('/api/state', { method: 'PATCH', cookie: account.cookie, body: { quizAttempts: [legacy] } });
  assert.equal(acceptedLegacy.status, 200);
  assert.equal(acceptedLegacy.data.state.quizAttempts.length, 2);
  assert.equal(acceptedLegacy.data.state.quizAttempts[1].answers, undefined);
});

test('requisições de outra origem e formulários não podem alterar a sessão nem o progresso', async t => {
  const { request, origin } = await fixture(t);
  const account = await register(request);
  const payload = { completedChapters: { 'genesis:1': true } };
  assert.equal((await request('/api/state', { method: 'PATCH', body: payload, cookie: account.cookie, headers: { Origin: 'https://outro-site.example' } })).status, 403);
  assert.equal((await request('/api/state', { method: 'PATCH', body: payload, cookie: account.cookie, headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request('/api/auth/logout', { method: 'POST', body: {}, cookie: account.cookie, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await request('/api/session', { cookie: account.cookie })).data.user.id, account.data.user.id);
  assert.equal((await request('/api/state', { method: 'PATCH', body: payload, cookie: account.cookie, headers: { Origin: origin } })).status, 200);
});

test('estado continua no SQLite quando o aplicativo é reiniciado', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'vereda-restart-'));
  for (const [file, value] of Object.entries(fixtures)) writeFileSync(path.join(directory, `${file}.json`), JSON.stringify(value));
  const dbPath = path.join(directory, 'state.sqlite');
  const options = { dataDir: directory, dbPath, distDir: path.join(directory, 'no-dist'), rateLimitEnabled: false };
  const app = await createApp(options);
  let server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let origin = `http://127.0.0.1:${server.address().port}`;
  const registered = await fetch(`${origin}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Persistente', email: 'persistir@example.test', password: 'senha-de-teste-123' }) });
  assert.equal(registered.status, 201);
  const cookie = registered.headers.get('set-cookie').split(';')[0];
  await registered.json();
  const patch = await fetch(`${origin}/api/state`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ completedChapters: { 'genesis:1': true }, preferences: { theme: 'dark' }, quizAttempts: [{ id: 'restart-answer', quizId: 'quiz-organizacao', score: 0, total: 1, createdAt: '2026-10-27T12:00:00Z', answers: [1] }] }) });
  assert.equal(patch.status, 200);
  await patch.json();
  await new Promise(resolve => server.close(resolve));
  await app.locals.close();
  const restored = await createApp(options);
  server = restored.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await restored.locals.close(); rmSync(directory, { recursive: true, force: true }); });
  const response = await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.state.completedChapters['genesis:1'], true);
  assert.equal(result.state.preferences.theme, 'dark');
  assert.deepEqual(result.state.quizAttempts[0].answers, [1]);
  assert.equal(result.state.quizAttempts[0].score, 0);
});
