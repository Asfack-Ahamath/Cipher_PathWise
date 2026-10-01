import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { one, q, type Db } from '../db.js';
import { bad, notFound } from '../errors.js';
import { sbDownload, sbEnsureBucket, sbSignedUrl, sbUpload } from './supabase.js';

/* Photos and signatures. STORAGE_PROVIDER=db keeps the bytes in PostgreSQL (works with no extra
   service, including docker compose); STORAGE_PROVIDER=supabase puts them in a private Supabase
   Storage bucket and serves short-lived signed URLs. The API checks who may see each file. */
export type AttachmentKind = 'pod_photo' | 'pod_signature' | 'receipt_photo' | 'problem_photo';
const MAX_BYTES = 5 * 1024 * 1024;
const MIME = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/;

export function parseDataUrl(dataUrl: string): { mime: string; bytes: Buffer } {
  const m = MIME.exec(dataUrl.trim());
  if (!m) throw bad('Images must be JPEG, PNG or WebP.');
  const bytes = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  if (!bytes.length) throw bad('The image is empty.');
  if (bytes.length > MAX_BYTES) throw bad('Images must be 5 MB or smaller.');
  // magic numbers — do not trust the declared type
  const sig = bytes.subarray(0, 12).toString('hex');
  const ok = (m[1] === 'image/jpeg' && sig.startsWith('ffd8ff')) || (m[1] === 'image/png' && sig.startsWith('89504e47')) || (m[1] === 'image/webp' && sig.startsWith('52494646') && bytes.subarray(8, 12).toString() === 'WEBP');
  if (!ok) throw bad('The file content does not match its image type.');
  return { mime: m[1], bytes };
}

let bucketReady: Promise<void> | null = null;

export async function saveAttachment(db: Db, dataUrl: string, meta: { kind: AttachmentKind; outletId?: string | null; tripId?: number | null; userId: number }): Promise<string> {
  const { mime, bytes } = parseDataUrl(dataUrl);
  const id = randomUUID();
  if (config.storageProvider === 'supabase') {
    bucketReady ??= sbEnsureBucket().catch(e => { bucketReady = null; throw e; });
    await bucketReady;
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const path = `${meta.kind}/${meta.outletId ?? 'none'}/${id}.${ext}`;
    await sbUpload(path, bytes, mime);
    await q(`INSERT INTO attachments (id, kind, storage, path, mime, bytes, outlet_id, trip_id, created_by) VALUES ($1,$2,'supabase',$3,$4,$5,$6,$7,$8)`, [id, meta.kind, path, mime, bytes.length, meta.outletId ?? null, meta.tripId ?? null, meta.userId], db);
  } else {
    await q(`INSERT INTO attachments (id, kind, storage, mime, bytes, data, outlet_id, trip_id, created_by) VALUES ($1,$2,'db',$3,$4,$5,$6,$7,$8)`, [id, meta.kind, mime, bytes.length, bytes.toString('base64'), meta.outletId ?? null, meta.tripId ?? null, meta.userId], db);
  }
  return id;
}

export interface AttachmentRow { id: string; kind: AttachmentKind; storage: 'db' | 'supabase'; path: string | null; mime: string; data: string | null; outlet_id: string | null; trip_id: number | null }
export async function getAttachment(id: string): Promise<AttachmentRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('File not found.');
  const a = await one<AttachmentRow>(`SELECT id, kind, storage, path, mime, data, outlet_id, trip_id FROM attachments WHERE id = $1`, [id]);
  if (!a) throw notFound('File not found.');
  return a;
}
/** Bytes for the API to stream, or a signed URL to redirect to. */
export async function readAttachment(a: AttachmentRow): Promise<{ bytes?: Buffer; redirect?: string }> {
  if (a.storage === 'db') return { bytes: Buffer.from(a.data ?? '', 'base64') };
  try { return { redirect: await sbSignedUrl(a.path!) }; }
  catch { return { bytes: await sbDownload(a.path!) }; }
}
