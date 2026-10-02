import { assertConfig, config } from './config.js';
import { loadClock } from './clock.js';
import { migrate } from './migrate.js';
import { seedIfEmpty } from './seed/seed.js';
import { buildServer } from './server.js';
import { sbEnsureBucket } from './lib/supabase.js';
import { addresses, banner, cyan, ok, step, warn } from './lib/console.js';

assertConfig();

async function waitForDb(tries = 30) {
  const { pool } = await import('./db.js');
  for (let i = 0; i < tries; i++) {
    try { await pool.query('SELECT 1'); return; }
    catch (e: any) { if (i === tries - 1) throw new Error(`Database is not reachable: ${e.message}`); await new Promise(r => setTimeout(r, 1000)); }
  }
}

step('Connecting to the database');
await waitForDb();
ok('Database connected');
await migrate();
if (config.storageProvider === 'supabase') {
  try { await sbEnsureBucket(); ok(`Storage ready (Supabase bucket "${config.supabase.bucket}")`); }
  catch (e: any) { warn(`Storage: could not prepare the Supabase bucket (${e.message}). Uploads will retry.`); }
}
if (config.seedOnStart) await seedIfEmpty();
await loadClock();
const app = await buildServer();
await app.listen({ port: config.port, host: config.host });
const { local, network } = addresses(config.port, config.host);
banner('PathWise API', [
  ['Local', cyan(local)],
  ...(network ? [['Network', cyan(network)] as [string, string]] : []),
  ['Mode', `${config.isProd ? 'production' : 'development'} · demo ${config.demoMode ? 'on' : 'off'}`],
  ['Auth', config.authProvider],
  ['Storage', config.storageProvider],
]);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, async () => {
    step(`${sig} received, shutting down`);
    const { pool } = await import('./db.js');
    await app.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  });
}
