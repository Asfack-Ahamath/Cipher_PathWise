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
const env = (k: string, d?: string) => { const v = process.env[k]; return v === undefined || v === '' ? d : v; };
const bool = (k: string, d: boolean) => { const v = env(k); return v === undefined ? d : /^(1|true|yes|on)$/i.test(v); };
const list = (k: string) => (env(k) ?? '').split(',').map(s => s.trim()).filter(Boolean);

const isProd = env('NODE_ENV') === 'production';

export const config = {
  env: env('NODE_ENV', 'development')!,
  isProd,
  port: Number(env('PORT', '8080')),
  host: env('HOST', '0.0.0.0')!,
  databaseUrl: env('DATABASE_URL', 'postgres://pathwise:pathwise@localhost:5432/pathwise')!,
  databaseSsl: bool('DATABASE_SSL', false),
  jwtSecret: env('JWT_SECRET', 'dev-only-change-me-please-32-characters!!')!,
  /** Browser origins allowed to call the API cross-origin. Empty = same origin only (the API serves the web app). */
  corsOrigins: list('CORS_ORIGINS'),
  /** Built web app served by the API in production (single container). */
  webDist: env('WEB_DIST', path.resolve(here, '../../web/dist'))!,
  dataDir: env('DATA_DIR', path.resolve(here, '../../../data'))!,
  seedOnStart: bool('SEED_ON_START', true),
  /** Allow the "Reset demo day" and demo clock controls (keep on for judging; turn off for a real rollout). */
  demoMode: bool('DEMO_MODE', true),
  /** Business clock start for the seeded day, Sri Lanka time. */
  demoClockStart: env('DEMO_CLOCK_START', '2026-04-30T02:30:00+05:30')!,
  demoPassword: env('DEMO_PASSWORD', 'PathWise@2026')!,
  /** First administrator, created on the first start. */
  adminEmail: env('ADMIN_EMAIL', 'admin@pathwise.lk')!.toLowerCase(),
  adminPassword: env('ADMIN_PASSWORD', '')!,
  /** Public URL of the web app (password-recovery links, CORS default). */
  appUrl: (env('APP_URL', '') ?? '').replace(/\/+$/, ''),
  /** Trust X-Forwarded-For from the hosting proxy (Render, Fly, Railway …) for rate limits and audit IPs. */
  trustProxy: bool('TRUST_PROXY', isProd),
  timeZone: 'Asia/Colombo',
  logLevel: env('LOG_LEVEL', 'info')!,

  /** Who checks passwords: 'local' (bcrypt in the users table) or 'supabase' (Supabase Auth). */
  authProvider: (env('AUTH_PROVIDER', 'local') === 'supabase' ? 'supabase' : 'local') as 'local' | 'supabase',
  /** Where proof photos and signatures are stored: 'db' (PostgreSQL) or 'supabase' (Supabase Storage). */
  storageProvider: (env('STORAGE_PROVIDER', 'db') === 'supabase' ? 'supabase' : 'db') as 'db' | 'supabase',
  supabase: {
    url: (env('SUPABASE_URL', '') ?? '').replace(/\/+$/, ''),
    anonKey: env('SUPABASE_ANON_KEY', '')!,
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY', '')!,
    bucket: env('SUPABASE_STORAGE_BUCKET', 'pathwise-proofs')!,
  },
};

/** Fail fast on settings that would make a production deployment unsafe or broken. */
export function assertConfig() {
  const problems: string[] = [];
  const weakSecret = config.jwtSecret.length < 32 || config.jwtSecret.startsWith('dev-only') || config.jwtSecret.startsWith('change-me');
  // a real rollout (DEMO_MODE=false) refuses to start with a guessable signing key; the judges' demo only warns
  if (config.isProd && weakSecret) {
    if (config.demoMode) console.warn('[pathwise] JWT_SECRET is the placeholder value. Fine for the demo; set a random 32+ character secret before real use.');
    else problems.push('JWT_SECRET must be a random value of at least 32 characters when DEMO_MODE=false (e.g. openssl rand -base64 48).');
  }
  const needsSupabase = config.authProvider === 'supabase' || config.storageProvider === 'supabase';
  if (needsSupabase && !config.supabase.url) problems.push('SUPABASE_URL is required when AUTH_PROVIDER or STORAGE_PROVIDER is "supabase".');
  if (needsSupabase && !config.supabase.serviceRoleKey) problems.push('SUPABASE_SERVICE_ROLE_KEY is required when AUTH_PROVIDER or STORAGE_PROVIDER is "supabase".');
  if (config.authProvider === 'supabase' && !config.supabase.anonKey) problems.push('SUPABASE_ANON_KEY is required when AUTH_PROVIDER is "supabase".');
  if (config.isProd && config.demoMode) console.warn('[pathwise] DEMO_MODE is on in production: demo accounts, the demo clock and "Reset demo day" are enabled. Set DEMO_MODE=false for a real rollout.');
  if (config.adminPassword && config.adminPassword.length < 10) problems.push('ADMIN_PASSWORD must be at least 10 characters.');
  if (problems.length) throw new Error(`Configuration error:\n - ${problems.join('\n - ')}`);
}
