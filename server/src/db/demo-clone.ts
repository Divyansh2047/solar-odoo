/**
 * Copy one workspace into a new one, fast (a few dozen statements): every id remapped through
 * sequence-allocated mapping tables, every public token regenerated, every date shifted so "today" in
 * the copy is today. Used to hand each demo visitor a private, fully populated workspace instantly.
 * Runs in system scope inside the caller's transaction.
 */
import type pg from 'pg';

type Db = pg.PoolClient;

/** Never copied: credentials, links and admin trail. */
const SKIP = new Set(['sessions', 'auth_codes', 'share_links', 'audit_log']);
/** Columns holding ids without a foreign key. */
const EXTRA_REFS: Record<string, string> = { 'install_reports.visit_id': 'visits', 'timesheets.visit_id': 'visits' };
const TOKEN_COLUMNS: Record<string, string[]> = { customers: ['portal_token'], quotes: ['public_token'], invoices: ['public_token'] };
const COMPANY_COPY = [
  'timezone', 'phone', 'email', 'address', 'gstin', 'advance_percent', 'labour_rate_paise', 'sla_first_call_minutes', 'quote_validity_days',
  'subsidy_enabled', 'subsidy_slab1_kw', 'subsidy_slab1_per_kw_paise', 'subsidy_slab2_kw', 'subsidy_slab2_per_kw_paise', 'subsidy_cap_paise',
];

interface TableInfo {
  name: string;
  cols: { name: string; type: string; nullable: boolean }[];
  hasId: boolean;
  /** column -> referenced table (remapped through that table's id map) */
  refs: Map<string, string>;
}

let cache: TableInfo[] | null = null;

async function introspect(db: Db): Promise<TableInfo[]> {
  if (cache) return cache;
  const cols = await db.query<{ table_name: string; column_name: string; data_type: string; is_identity: string; is_nullable: string }>(
    `SELECT table_name, column_name, data_type, is_identity, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'company_id')
      ORDER BY table_name, ordinal_position`,
  );
  const fks = await db.query<{ tbl: string; ref: string; cols: string[] }>(
    `SELECT c.conrelid::regclass::text AS tbl, c.confrelid::regclass::text AS ref, array_agg(a.attname::text ORDER BY k.ord) AS cols
       FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace GROUP BY c.oid, c.conrelid, c.confrelid`,
  );
  const tables = new Map<string, TableInfo>();
  for (const c of cols.rows) {
    if (SKIP.has(c.table_name)) continue;
    let t = tables.get(c.table_name);
    if (!t) tables.set(c.table_name, (t = { name: c.table_name, cols: [], hasId: false, refs: new Map() }));
    t.cols.push({ name: c.column_name, type: c.data_type, nullable: c.is_nullable === 'YES' });
    if (c.column_name === 'id' && c.is_identity === 'YES') t.hasId = true;
  }
  for (const f of fks.rows) {
    const t = tables.get(f.tbl);
    if (!t || f.ref === 'companies') continue;
    for (const col of f.cols) if (col !== 'company_id') t.refs.set(col, f.ref);
  }
  for (const t of tables.values()) {
    for (const c of t.cols) {
      const extra = EXTRA_REFS[`${t.name}.${c.name}`];
      if (extra) t.refs.set(c.name, extra);
      else if (!t.refs.has(c.name) && c.type === 'bigint' && (/_by$/.test(c.name) || c.name === 'actor_id')) t.refs.set(c.name, 'users');
    }
  }
  cache = [...tables.values()];
  return cache;
}

/** Insert order that respects foreign keys; columns on a cycle are filled in afterwards. */
function plan(tables: TableInfo[]): { order: TableInfo[]; deferred: Map<string, string[]> } {
  const names = new Set(tables.map((t) => t.name));
  const done = new Set<string>();
  const order: TableInfo[] = [];
  const deferred = new Map<string, string[]>();
  const pending = [...tables];
  while (pending.length) {
    const i = pending.findIndex((t) => [...t.refs].every(([col, ref]) => ref === t.name || done.has(ref) || !names.has(ref) || deferred.get(t.name)?.includes(col)));
    if (i >= 0) {
      const [t] = pending.splice(i, 1);
      done.add(t!.name);
      order.push(t!);
      continue;
    }
    // break a cycle: defer the unmet references of a table whose unmet references are all nullable
    const candidates = pending
      .map((t) => ({ t, unmet: [...t.refs].filter(([c, ref]) => ref !== t.name && names.has(ref) && !done.has(ref) && !deferred.get(t.name)?.includes(c)).map(([c]) => c) }))
      .filter((x) => x.unmet.length && x.unmet.every((c) => x.t.cols.find((col) => col.name === c)?.nullable))
      .sort((a, b) => a.unmet.length - b.unmet.length);
    const best = candidates[0];
    if (!best) throw new Error(`Can't order tables for copying: ${pending.map((t) => t.name).join(', ')}`);
    deferred.set(best.t.name, [...(deferred.get(best.t.name) ?? []), ...best.unmet]);
  }
  return { order, deferred };
}

export async function cloneWorkspace(
  db: Db,
  sourceId: number,
  opts: { name: string; kind: 'demo' | 'real'; now: Date; shiftMs: number; shiftDays: number; emailSlug: string; expiresAt: Date | null },
): Promise<{ companyId: number; ownerId: number }> {
  const tables = await introspect(db);
  const { order, deferred } = plan(tables);

  const co = await db.query<{ id: number }>(
    `INSERT INTO companies (name, kind, demo_expires_at, created_at, ${COMPANY_COPY.join(', ')})
     SELECT $2, $3, $4, $5, ${COMPANY_COPY.join(', ')} FROM companies WHERE id = $1 RETURNING id`,
    [sourceId, opts.name, opts.kind, opts.expiresAt, opts.now],
  );
  const newId = co.rows[0]!.id;
  const shift = `make_interval(secs => ${Math.round(opts.shiftMs / 1000)})`;

  // 1. id maps, allocated from each table's own identity sequence (no collisions with live inserts)
  for (const t of tables) {
    if (!t.hasId) continue;
    await db.query(
      `CREATE TEMP TABLE map_${t.name} ON COMMIT DROP AS
         SELECT id AS old, nextval(pg_get_serial_sequence('${t.name}', 'id')) AS new FROM ${t.name} WHERE company_id = $1`,
      [sourceId],
    );
    await db.query(`ALTER TABLE map_${t.name} ADD PRIMARY KEY (old)`);
  }

  // 2. copy rows table by table
  for (const t of order) {
    const defer = deferred.get(t.name) ?? [];
    const exprs = t.cols.map((c) => {
      const col = `s.${c.name}`;
      if (c.name === 'company_id') return `${newId}`;
      if (c.name === 'id' && t.hasId) return `(SELECT new FROM map_${t.name} WHERE old = s.id)`;
      const ref = t.refs.get(c.name);
      if (ref) {
        if (defer.includes(c.name)) return 'NULL';
        return `(SELECT new FROM map_${ref} WHERE old = ${col})`;
      }
      if (TOKEN_COLUMNS[t.name]?.includes(c.name)) return `replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')`;
      if (t.name === 'users' && c.name === 'email') return `regexp_replace(${col}, '\\.[^.@]+@', '.${opts.emailSlug}@')`;
      if (c.type === 'timestamp with time zone') return `${col} + ${shift}`;
      if (c.type === 'date') return `${col} + ${opts.shiftDays}`;
      if (c.type === 'tstzrange') return `tstzrange(lower(${col}) + ${shift}, upper(${col}) + ${shift}, '[)')`;
      return col;
    });
    const names = t.cols.map((c) => c.name).join(', ');
    await db.query(
      `INSERT INTO ${t.name} (${names}) ${t.hasId ? 'OVERRIDING SYSTEM VALUE' : ''} SELECT ${exprs.join(', ')} FROM ${t.name} s WHERE s.company_id = $1 ${t.hasId ? 'ORDER BY s.id' : ''}`,
      [sourceId],
    );
  }

  // 3. fill references that sat on a cycle
  for (const [table, cols] of deferred) {
    const t = tables.find((x) => x.name === table)!;
    const sets = cols.map((c) => `${c} = (SELECT m.new FROM map_${t.refs.get(c)} m WHERE m.old = s.${c})`).join(', ');
    await db.query(
      `UPDATE ${table} d SET ${sets} FROM ${table} s JOIN map_${table} mm ON mm.old = s.id WHERE d.id = mm.new AND s.company_id = $1 AND (${cols.map((c) => `s.${c} IS NOT NULL`).join(' OR ')})`,
      [sourceId],
    );
  }

  const owner = await db.query<{ id: number }>(`SELECT id FROM users WHERE company_id = $1 AND role = 'owner' ORDER BY id LIMIT 1`, [newId]);
  return { companyId: newId, ownerId: owner.rows[0]!.id };
}
