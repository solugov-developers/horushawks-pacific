import { db, pool } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

export const REPORT_COLUMNS = [
  'scraper_name',
  'scraped_at',
  'source_key',
  'item_id',
  'item_name',
  'category_name',
  'serial_number',
  'bundle',
  'color',
  'location',
  'thickness',
  'available_qty',
  'available_slabs',
  'price',
  'price_range',
  'on_hold',
  'on_so',
  'in_transit',
] as const;

export type ReportRow = Record<(typeof REPORT_COLUMNS)[number], unknown>;

export interface ScraperOption {
  id: number;
  name: string;
}

export async function listScraperOptions(): Promise<ScraperOption[]> {
  const r = await db.execute(sql`SELECT id, name FROM scrapers ORDER BY name`);
  return r.rows as unknown as ScraperOption[];
}

interface QueryOpts {
  from: string;        // 'YYYY-MM-DD' inclusive
  toExclusive: string; // 'YYYY-MM-DD' exclusive
  scraperIds: number[] | null;
}

export async function queryInventoryReport(opts: QueryOpts): Promise<ReportRow[]> {
  const scraperFilter = opts.scraperIds && opts.scraperIds.length
    ? sql` AND h.scraper_id = ANY(${opts.scraperIds})`
    : sql``;

  const r = await db.execute(sql`
    SELECT
      s.name           AS scraper_name,
      h.scraped_at,
      h.source_key,
      h.item_id,
      h.item_name,
      h.category_name,
      h.serial_number,
      h.bundle,
      h.color,
      h.location,
      h.thickness,
      h.available_qty,
      h.available_slabs,
      h.price,
      h.price_range,
      h.on_hold,
      h.on_so,
      h.in_transit
    FROM slabs_history h
    JOIN scrapers s ON s.id = h.scraper_id
    WHERE h.scraped_at >= ${opts.from}::date
      AND h.scraped_at <  ${opts.toExclusive}::date
      ${scraperFilter}
    ORDER BY h.scraped_at, s.name, h.source_key
  `);
  return r.rows as unknown as ReportRow[];
}

/**
 * Streaming do relatório via CURSOR server-side. Faz UMA query ordenada e vai
 * buscando em blocos (FETCH), mantendo memória constante no app — ao contrário de
 * queryInventoryReport, que carrega tudo. Usado pelo export de arquivo grande.
 *
 * A conexão fica reservada enquanto o gerador é consumido; o `finally` faz
 * ROLLBACK+release mesmo se o consumidor abortar (return()) — ex.: download
 * cancelado no navegador. Preserva a mesma ordenação de queryInventoryReport.
 */
export async function* streamInventoryRows(
  opts: QueryOpts,
  batchSize = 2000,
): AsyncGenerator<ReportRow[]> {
  const params: unknown[] = [opts.from, opts.toExclusive];
  let scraperFilter = '';
  if (opts.scraperIds && opts.scraperIds.length) {
    params.push(opts.scraperIds);
    scraperFilter = ` AND h.scraper_id = ANY($${params.length})`;
  }

  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    await client.query(
      `DECLARE report_cur NO SCROLL CURSOR FOR
       SELECT
         s.name AS scraper_name, h.scraped_at, h.source_key, h.item_id, h.item_name,
         h.category_name, h.serial_number, h.bundle, h.color, h.location, h.thickness,
         h.available_qty, h.available_slabs, h.price, h.price_range,
         h.on_hold, h.on_so, h.in_transit
       FROM slabs_history h
       JOIN scrapers s ON s.id = h.scraper_id
       WHERE h.scraped_at >= $1::date AND h.scraped_at < $2::date${scraperFilter}
       ORDER BY h.scraped_at, s.name, h.source_key`,
      params,
    );
    for (;;) {
      // batchSize é constante controlada, seguro interpolar.
      const r = await client.query(`FETCH ${batchSize} FROM report_cur`);
      if (r.rows.length === 0) break;
      yield r.rows as unknown as ReportRow[];
    }
    await client.query('COMMIT');
    committed = true;
  } finally {
    if (!committed) {
      try { await client.query('ROLLBACK'); } catch { /* conexão já pode estar suja */ }
    }
    client.release();
  }
}

export async function countInventoryReport(opts: QueryOpts): Promise<number> {
  const scraperFilter = opts.scraperIds && opts.scraperIds.length
    ? sql` AND h.scraper_id = ANY(${opts.scraperIds})`
    : sql``;
  const r = await db.execute(sql`
    SELECT count(*)::bigint AS n
    FROM slabs_history h
    WHERE h.scraped_at >= ${opts.from}::date
      AND h.scraped_at <  ${opts.toExclusive}::date
      ${scraperFilter}
  `);
  const row = r.rows[0] as { n: string | number } | undefined;
  return row ? Number(row.n) : 0;
}
