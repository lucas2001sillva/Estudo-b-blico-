// Browser tests intentionally create many independent accounts in one run.
// Production limits are exercised separately by security.test.mjs; never add
// an environment switch that disables them in the deployed server.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (!process.env.DB_PATH?.startsWith('/tmp/')) throw new Error('Os testes precisam de um banco temporário em /tmp.');
const app = await createApp({
  dataDir: path.join(root, 'content'),
  distDir: path.join(root, 'dist'),
  dbPath: process.env.DB_PATH,
  rateLimitEnabled: false,
});
const server = app.listen(Number(process.env.PORT || 3001), '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close(async () => { await app.locals.close(); process.exit(0); });
  server.closeIdleConnections();
});
