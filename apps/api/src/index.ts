import { assertConfig, config } from './config.js';
import { loadClock } from './clock.js';
import { migrate } from './migrate.js';
import { seedIfEmpty } from './seed/seed.js';
import { buildServer } from './server.js';
import { sbEnsureBucket } from './lib/supabase.js';

assertConfig();

async function waitForDb(tries = 30) {
  const { pool } = await import('./db.js');
  for (let i = 0; i < tries; i++) {
    try { await pool.query('SELECT 1'); return; }
    catch (e: any) { if (i === tries - 1) throw new Error(`Database is not reachable: ${e.message}`); await new Promise(r => setTimeout(r, 1000)); }
  }
}

await waitForDb();
await migrate();
if (config.storageProvider === 'supabase') {
  try { await sbEnsureBucket(); console.log(`storage: Supabase bucket "${config.supabase.bucket}" ready`); }
  catch (e: any) { console.error(`storage: could not prepare the Supabase bucket (${e.message}). Uploads will retry.`); }
}
if (config.seedOnStart) await seedIfEmpty();
await loadClock();
const app = await buildServer();
await app.listen({ port: config.port, host: config.host });
app.log.info(`PathWise API on :${config.port} · auth=${config.authProvider} · storage=${config.storageProvider} · demo=${config.demoMode}`);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, async () => {
    app.log.info(`${sig}: shutting down`);
    const { pool } = await import('./db.js');
    await app.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  });
}
