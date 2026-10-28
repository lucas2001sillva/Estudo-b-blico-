import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser uma porta válida.');
const app = await createApp({
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'content'),
  dbPath: process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(root, 'var', 'vereda.sqlite'),
  databaseUrl: process.env.DATABASE_URL,
  databaseAuthToken: process.env.DATABASE_AUTH_TOKEN,
  databaseRequestTimeoutMs: process.env.DATABASE_REQUEST_TIMEOUT_MS === undefined ? undefined : Number(process.env.DATABASE_REQUEST_TIMEOUT_MS),
  requireRemoteDatabase: process.env.REQUIRE_REMOTE_DATABASE === '1' || process.env.RENDER === 'true',
  distDir: path.join(root, 'dist'),
  allowedOrigins: process.env.PUBLIC_ORIGIN ? [process.env.PUBLIC_ORIGIN] : [],
  trustProxy: process.env.TRUST_PROXY === '1' ? 1 : false,
  secureCookies: process.env.SECURE_COOKIES === '1',
});
const server = app.listen(port, '0.0.0.0', () => console.log(`Vereda Bíblica: servidor iniciado na porta ${port}.`));
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async () => { await app.locals.close(); process.exit(0); });
    setTimeout(() => { server.closeAllConnections(); }, 5000).unref();
  });
}
