import fs from 'node:fs';
fs.mkdirSync('dist/migrations', { recursive: true });
for (const f of fs.readdirSync('src/migrations')) fs.copyFileSync(`src/migrations/${f}`, `dist/migrations/${f}`);
