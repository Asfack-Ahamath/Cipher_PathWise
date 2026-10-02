/* Run PathWise on a laptop with only Node.js installed — no Docker, no PostgreSQL install.
   A real PostgreSQL (embedded-postgres, downloaded by npm for your OS) runs from ./.pgdata.

     npm run local        build once, then serve everything on http://localhost:3000
     npm run local:dev    development mode (API + Vite with hot reload on http://localhost:5173)
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] === 'dev' ? 'dev' : 'start';
const dataDir = path.join(root, '.pgdata');
const pgPort = Number(process.env.LOCAL_PG_PORT ?? 5499);
const appPort = process.env.PORT ?? '8080';

const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'pathwise', password: 'pathwise', port: pgPort, persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-messages=C'], onLog: () => {}, onError: m => process.env.PG_DEBUG && console.error(String(m)) });

if (typeof process.getuid === 'function' && process.getuid() === 0) {
  console.error('PostgreSQL refuses to run as root. Run "npm run local" as a normal user, or use "docker compose up".');
  process.exit(1);
}
const firstRun = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
if (firstRun) { console.log('› Setting up the local database in .pgdata (first run only)…'); await pg.initialise(); }
console.log(`› Starting PostgreSQL on port ${pgPort}…`);
await pg.start();
try { await pg.createDatabase('pathwise'); } catch { /* already there */ }

const env = {
  ...process.env,
  DATABASE_URL: `postgres://pathwise:pathwise@localhost:${pgPort}/pathwise`,
  JWT_SECRET: process.env.JWT_SECRET ?? 'local-laptop-secret-at-least-32-characters',
  PORT: appPort,
};

if (mode === 'start' && !fs.existsSync(path.join(root, 'apps/api/dist/index.js'))) {
  console.error('The app is not built yet. Run: npm run local   (it builds first)');
  await pg.stop(); process.exit(1);
}
const child = mode === 'dev'
  ? spawn('npm run dev', { cwd: root, env, stdio: 'inherit', shell: true })
  : spawn(process.execPath, ['apps/api/dist/index.js'], { cwd: root, env, stdio: 'inherit' });

if (mode === 'start') console.log(`› PathWise will be on http://localhost:${appPort} in a few seconds (Ctrl+C to stop).`);
else console.log('› PathWise dev: http://localhost:5173 (Ctrl+C to stop).');

let stopping = false;
const stop = async (code = 0) => {
  if (stopping) return; stopping = true;
  try { child.kill(); } catch { /* ignore */ }
  console.log('\n› Stopping PostgreSQL…');
  try { await pg.stop(); } catch { /* ignore */ }
  process.exit(code);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
child.on('exit', code => stop(code ?? 0));
