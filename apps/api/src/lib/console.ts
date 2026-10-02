import os from 'node:os';

const tty = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = paint('1'), dim = paint('2'), red = paint('31'), green = paint('32'), yellow = paint('33'), cyan = paint('36'), gray = paint('90');

const clock = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
const line = (mark: string, msg: string) => console.log(`${gray(clock())}  ${mark}  ${msg}`);

export const step = (msg: string) => line(cyan('›'), msg);
export const ok = (msg: string) => line(green('✔'), msg);
export const warn = (msg: string) => line(yellow('▲'), yellow(msg));
export const fail = (msg: string) => line(red('✖'), red(msg));

export function banner(title: string, rows: [string, string][]) {
  const w = Math.max(...rows.map(([k]) => k.length));
  console.log('');
  console.log(`  ${bold(title)}`);
  console.log(`  ${gray('─'.repeat(46))}`);
  for (const [k, v] of rows) console.log(`  ${gray(k.padEnd(w))}  ${v}`);
  console.log('');
}

export function addresses(port: number, host: string) {
  const local = `http://localhost:${port}`;
  if (host === 'localhost' || host === '127.0.0.1') return { local, network: null as string | null };
  const ip = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
  return { local, network: ip ? `http://${ip}:${port}` : null };
}

const methodColor = (m: string) => (m === 'GET' ? cyan : m === 'DELETE' ? red : yellow)(m.padEnd(6));
const statusColor = (s: number) => (s >= 500 ? red : s >= 400 ? yellow : green)(String(s));

/** Pretty one-line-per-request output for development; production keeps pino's JSON. */
export function devLogStream() {
  const pending = new Map<string, string>();
  return {
    write(raw: string) {
      let o: any;
      try { o = JSON.parse(raw); } catch { process.stdout.write(raw); return; }
      if (o.msg === 'incoming request') { pending.set(o.reqId, `${methodColor(o.req?.method ?? '')} ${o.req?.url ?? ''}`); return; }
      if (o.msg === 'request completed') {
        const what = pending.get(o.reqId) ?? ''; pending.delete(o.reqId);
        if (/^\S+\s+\/(assets|@vite|src)\b/.test(what.replace(/\x1b\[[0-9;]*m/g, ''))) return;
        line(' ', `${what}  ${statusColor(o.res?.statusCode ?? 0)} ${dim(`${Math.round(o.responseTime ?? 0)}ms`)}`);
        return;
      }
      const err = o.err?.message ? ` ${dim(`(${o.err.message})`)}` : '';
      if (o.level >= 50) fail(`${o.msg ?? 'error'}${err}`);
      else if (o.level >= 40) warn(String(o.msg ?? ''));
      else if (o.msg) step(String(o.msg));
    },
  };
}
