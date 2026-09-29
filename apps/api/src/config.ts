import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

// Local development: read the repo-root .env (Docker and hosts pass real environment variables instead).
for (const file of [path.resolve(here, '../../../.env'), path.resolve(process.cwd(), '.env')]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  break;
}
const env = (k: string, d?: string) => process.env[k] ?? d;

export const config = {
  port: Number(env('PORT', '8080')),
  host: env('HOST', '0.0.0.0')!,
  databaseUrl: env('DATABASE_URL', 'postgres://pathwise:pathwise@localhost:5432/pathwise')!,
  jwtSecret: env('JWT_SECRET', 'dev-only-change-me-please-32-characters!!')!,
  /** Built web app served by the API in production (single container). */
  webDist: env('WEB_DIST', path.resolve(here, '../../web/dist'))!,
  dataDir: env('DATA_DIR', path.resolve(here, '../../../data'))!,
  seedOnStart: env('SEED_ON_START', 'true') === 'true',
  /** Business clock start for the seeded day, Sri Lanka time. */
  demoClockStart: env('DEMO_CLOCK_START', '2026-04-30T02:30:00+05:30')!,
  demoPassword: env('DEMO_PASSWORD', 'PathWise@2026')!,
  timeZone: 'Asia/Colombo',
  logLevel: env('LOG_LEVEL', 'info')!,
};
