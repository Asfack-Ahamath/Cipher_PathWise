import { assertConfig } from './config.js';
import { migrate } from './migrate.js';
import { pool, q } from './db.js';
import { resetDay, seedConditions, seedIfEmpty } from './seed/seed.js';
import { hashPassword, PasswordPolicy } from './auth.js';

/* npm run db:migrate | db:seed | db:reset-demo | db:conditions | admin:set-password <email> <new password> */
const [cmd, ...args] = process.argv.slice(2);
const usage = 'usage: cli.ts migrate | seed | reset | conditions | set-password <email> <password>';
try {
  assertConfig();
  if (cmd === 'migrate') await migrate();
  else if (cmd === 'seed') { await migrate(); if (!(await seedIfEmpty())) console.log('Already seeded. Use "reset" to reload the demo day (DEMO_MODE only).'); }
  else if (cmd === 'reset') { await migrate(); await seedIfEmpty(); await resetDay(); }
  else if (cmd === 'conditions') { await migrate(); const c = await pool.connect(); try { await seedConditions(c); } finally { c.release(); } }
  else if (cmd === 'set-password') {
    const [email, password] = args;
    if (!email || !password) throw new Error(usage);
    const p = PasswordPolicy.safeParse(password);
    if (!p.success) throw new Error(p.error.issues[0].message);
    const r = await q(`UPDATE users SET password_hash = $2, must_change_password = false, failed_logins = 0, locked_until = NULL, is_active = true, token_version = token_version + 1 WHERE lower(email) = lower($1) RETURNING id`, [email, await hashPassword(password)]);
    console.log(r.length ? `Password set for ${email} (local sign-in).` : `No user with email ${email}.`);
  } else console.log(usage);
} catch (e: any) {
  console.error(e.message ?? e);
  process.exitCode = 1;
} finally { await pool.end(); }
