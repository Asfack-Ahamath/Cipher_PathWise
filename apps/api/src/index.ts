import { config } from './config.js';
import { loadClock } from './clock.js';
import { migrate } from './migrate.js';
import { seedIfEmpty } from './seed/seed.js';
import { buildServer } from './server.js';

async function waitForDb(tries = 30) {
  const { pool } = await import('./db.js');
  for (let i = 0; i < tries; i++) {
    try { await pool.query('SELECT 1'); return; } catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  throw new Error('Database is not reachable.');
}

await waitForDb();
await migrate();
if (config.seedOnStart) await seedIfEmpty();
await loadClock();
const app = await buildServer();
await app.listen({ port: config.port, host: config.host });
