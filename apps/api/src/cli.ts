import { migrate } from './migrate.js';
import { pool } from './db.js';
import { resetDay, seedIfEmpty } from './seed/seed.js';

const cmd = process.argv[2];
try {
  if (cmd === 'migrate') await migrate();
  else if (cmd === 'seed') { await migrate(); if (!(await seedIfEmpty())) console.log('already seeded — use "reset" to reload the demo day'); }
  else if (cmd === 'reset') { await migrate(); await seedIfEmpty(); await resetDay(); }
  else console.log('usage: cli.ts migrate | seed | reset');
} finally { await pool.end(); }
