/* A small stand-in for Supabase Auth + Storage (the REST endpoints PathWise calls), so the
   AUTH_PROVIDER=supabase and STORAGE_PROVIDER=supabase paths are tested without a real project. */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

export interface MockState { users: Map<string, { id: string; email: string; password: string; app_metadata: any; banned: boolean }>; buckets: Set<string>; objects: Map<string, { bytes: Buffer; mime: string }>; recoveries: string[]; tokens: Map<string, string> }

export function startSupabaseMock(keys: { anon: string; service: string }) {
  const state: MockState = { users: new Map(), buckets: new Set(), objects: new Map(), recoveries: [], tokens: new Map() };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url!, 'http://x');
    const key = req.headers.apikey;
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const json = () => (raw.length ? JSON.parse(raw.toString()) : {});
    const isService = key === keys.service && req.headers.authorization === `Bearer ${keys.service}`;
    if (key !== keys.anon && key !== keys.service) return send(401, { message: 'Invalid API key' });
    const p = url.pathname;
    // ── auth ──
    if (p === '/auth/v1/health') return send(200, { name: 'GoTrue' });
    if (p === '/auth/v1/token' && req.method === 'POST') {
      const b = json();
      const u = [...state.users.values()].find(x => x.email === String(b.email).toLowerCase());
      if (!u || u.password !== b.password || u.banned) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      return send(200, { access_token: 'at', user: { id: u.id, email: u.email, app_metadata: u.app_metadata } });
    }
    if (p === '/auth/v1/recover' && req.method === 'POST') {
      const b = json(); state.recoveries.push(String(b.email).toLowerCase());
      const u = [...state.users.values()].find(x => x.email === String(b.email).toLowerCase());
      if (u) { const t = `recovery-${randomUUID()}`; state.tokens.set(t, u.id); }
      return send(200, {});
    }
    if (p === '/auth/v1/user' && req.method === 'PUT') {
      const tok = String(req.headers.authorization ?? '').replace('Bearer ', '');
      const id = state.tokens.get(tok);
      if (!id) return send(401, { msg: 'invalid JWT' });
      const u = state.users.get(id)!; u.password = json().password; state.tokens.delete(tok);
      return send(200, { id: u.id, email: u.email });
    }
    if (p.startsWith('/auth/v1/admin/users')) {
      if (!isService) return send(403, { msg: 'not admin' });
      const id = p.split('/')[5];
      if (req.method === 'POST') {
        const b = json(); const email = String(b.email).toLowerCase();
        if ([...state.users.values()].some(u => u.email === email)) return send(422, { msg: 'A user with this email address has already been registered' });
        const u = { id: randomUUID(), email, password: b.password, app_metadata: b.app_metadata ?? {}, banned: false };
        state.users.set(u.id, u); return send(200, { id: u.id, email });
      }
      if (req.method === 'GET' && !id) {
        const page = Number(url.searchParams.get('page') ?? 1), per = Number(url.searchParams.get('per_page') ?? 50);
        return send(200, { users: [...state.users.values()].slice((page - 1) * per, page * per).map(u => ({ id: u.id, email: u.email })) });
      }
      if (req.method === 'PUT' && id) {
        const u = state.users.get(id); if (!u) return send(404, { msg: 'User not found' });
        const b = json();
        if (b.password) u.password = b.password;
        if (b.app_metadata) u.app_metadata = b.app_metadata;
        if (b.ban_duration) u.banned = b.ban_duration !== 'none';
        return send(200, { id: u.id, email: u.email });
      }
    }
    // ── storage ──
    if (p.startsWith('/storage/v1/')) {
      if (!isService) return send(403, { message: 'Unauthorized' });
      if (p.startsWith('/storage/v1/bucket/') && req.method === 'GET') { const b = p.split('/')[4]; return state.buckets.has(b) ? send(200, { id: b }) : send(400, { statusCode: '404', error: 'Bucket not found' }); }
      if (p === '/storage/v1/bucket' && req.method === 'POST') { const b = json(); state.buckets.add(b.id); return send(200, { name: b.id }); }
      if (p.startsWith('/storage/v1/object/sign/') && req.method === 'POST') {
        const path = p.replace('/storage/v1/object/sign/', '');
        if (!state.objects.has(path)) return send(400, { error: 'not_found' });
        return send(200, { signedURL: `/object/sign/${path}?token=signed-${Date.now()}` });
      }
      if (p.startsWith('/storage/v1/object/') && req.method === 'POST') {
        const path = p.replace('/storage/v1/object/', '');
        const bucket = path.split('/')[0];
        if (!state.buckets.has(bucket)) return send(400, { error: 'Bucket not found' });
        state.objects.set(path, { bytes: raw, mime: String(req.headers['content-type']) });
        return send(200, { Key: path });
      }
      if (p.startsWith('/storage/v1/object/') && req.method === 'GET') {
        const o = state.objects.get(p.replace('/storage/v1/object/', ''));
        if (!o) return send(404, { error: 'not_found' });
        res.writeHead(200, { 'Content-Type': o.mime }); return res.end(o.bytes);
      }
    }
    send(404, { message: `mock: no route ${req.method} ${p}` });
  });
  return new Promise<{ url: string; state: MockState; close: () => Promise<void> }>(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port;
      resolve({ url: `http://127.0.0.1:${port}`, state, close: () => new Promise(r => server.close(() => r())) });
    });
  });
}
