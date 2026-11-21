import type { Response } from 'express';
import pg from 'pg';
import { config, sslOption } from '../config.js';
import type { Db } from '../db/pool.js';
import { log } from './log.js';

/**
 * Live updates. Writers call publish() inside their transaction; Postgres delivers the NOTIFY only
 * after COMMIT, so screens never refresh to data that was rolled back. Every server instance LISTENs,
 * so this works with more than one instance (Round 1's in-memory hub did not).
 */
const CHANNEL = 'arka_events';

export type Topic =
  | 'leads'
  | 'surveys'
  | 'quotes'
  | 'jobs'
  | 'payments'
  | 'stock'
  | 'dispatch'
  | 'schedule'
  | 'installs'
  | 'tickets'
  | 'invoices'
  | 'subsidy'
  | 'payroll'
  | 'catalog'
  | 'team'
  | 'notifications'
  | 'dashboard';

interface Stream {
  companyId: number;
  userId: number;
  res: Response;
}

const streams = new Set<Stream>();
let listener: pg.Client | null = null;
let stopping = false;

export async function publish(db: Db, topics: Topic[]): Promise<void> {
  const all = Array.from(new Set<Topic>([...topics, 'dashboard']));
  await db.query(`SELECT pg_notify($1, json_build_object('c', app_company(), 't', $2::text[])::text)`, [CHANNEL, all]);
}

function deliver(payload: string): void {
  let msg: { c: number; t: string[] };
  try {
    msg = JSON.parse(payload);
  } catch {
    return;
  }
  const data = `event: change\ndata: ${JSON.stringify({ topics: msg.t })}\n\n`;
  for (const s of streams) if (s.companyId === msg.c) s.res.write(data);
}

export async function startEventListener(): Promise<void> {
  stopping = false;
  const connect = async (attempt = 0): Promise<void> => {
    const c = new pg.Client({ connectionString: config().DATABASE_URL, ssl: sslOption() });
    c.on('notification', (n) => n.channel === CHANNEL && n.payload && deliver(n.payload));
    c.on('error', (err) => {
      log.warn({ err }, 'event listener lost its connection; reconnecting');
      listener = null;
      if (!stopping) setTimeout(() => void connect(attempt + 1), Math.min(30_000, 1000 * 2 ** attempt));
    });
    try {
      await c.connect();
      await c.query(`LISTEN ${CHANNEL}`);
      listener = c;
    } catch (err) {
      log.warn({ err }, 'event listener could not connect');
      if (!stopping) setTimeout(() => void connect(attempt + 1), Math.min(30_000, 1000 * 2 ** attempt));
    }
  };
  await connect();
}

export async function stopEventListener(): Promise<void> {
  stopping = true;
  for (const s of streams) s.res.end();
  streams.clear();
  if (listener) {
    const l = listener;
    listener = null;
    await l.end().catch(() => {});
  }
}

export function openStream(res: Response, companyId: number, userId: number): () => void {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`retry: 4000\nevent: hello\ndata: {}\n\n`);
  const s: Stream = { companyId, userId, res };
  // at most 6 open streams per person (a few tabs); the oldest is closed first
  const mine = [...streams].filter((x) => x.userId === userId && x.companyId === companyId);
  for (const old of mine.slice(0, Math.max(0, mine.length - 5))) {
    streams.delete(old);
    old.res.end();
  }
  streams.add(s);
  const beat = setInterval(() => res.write(`: beat\n\n`), 25_000);
  return () => {
    clearInterval(beat);
    streams.delete(s);
  };
}

export const streamCount = () => streams.size;
