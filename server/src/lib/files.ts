import { createHash } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { invalid } from './errors.js';

export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export type FilePurpose = 'survey_photo' | 'install_photo' | 'signature' | 'ticket_photo';

/** Identify the image by its first bytes; the browser's claimed type is not trusted. */
export function sniffImage(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export async function saveFile(db: Db, purpose: FilePurpose, bytes: Buffer, userId: number | null, now: Date): Promise<{ id: number; size: number; mime: string }> {
  if (!bytes.length) throw invalid('The file is empty.');
  if (bytes.length > MAX_FILE_BYTES) throw invalid('Photos must be under 3 MB. The app shrinks them for you; try again.');
  const mime = sniffImage(bytes);
  if (!mime) throw invalid('Only JPEG, PNG or WebP images can be uploaded.');
  if (purpose === 'signature' && mime !== 'image/png') throw invalid('Signatures are saved as PNG.');
  // quota per workspace per day (row-level security scopes this count to the caller's workspace)
  const used = await db.query<{ n: number; bytes: number }>(
    `SELECT count(*)::int AS n, coalesce(sum(size), 0)::bigint AS bytes FROM files WHERE created_at > $1::timestamptz - interval '1 day'`,
    [now],
  );
  const u = used.rows[0]!;
  if (u.n >= 400 || u.bytes + bytes.length > 300 * 1024 * 1024) throw invalid('This workspace has uploaded a lot today. Try again tomorrow, or contact support.');
  const r = await db.query<{ id: number }>(
    `INSERT INTO files (purpose, mime, bytes, size, sha256, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [purpose, mime, bytes, bytes.length, createHash('sha256').update(bytes).digest('hex'), userId, now],
  );
  return { id: r.rows[0]!.id, size: bytes.length, mime };
}
