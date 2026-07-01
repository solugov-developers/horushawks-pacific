import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

export interface KindCount { kind: string; n: number }

export interface MovementRow {
  id: number;
  scraperId: number;
  jobId: number;
  prevJobId: number | null;
  sourceKey: string;
  kind: string;
  itemName: string | null;
  prevValue: string | null;
  nextValue: string | null;
  detectedAt: string;
}

export async function getMovementCounts(): Promise<KindCount[]> {
  const r = await db.execute(sql`
    SELECT kind, count(*)::int AS n
    FROM movements
    GROUP BY 1 ORDER BY 2 DESC
  `);
  return (r.rows as unknown as KindCount[]).map(k => ({ kind: k.kind, n: Number(k.n) }));
}

export async function getRecentMovements(limit = 100, kind?: string): Promise<MovementRow[]> {
  const r = kind
    ? await db.execute(sql`
        SELECT id, scraper_id, job_id, prev_job_id, source_key, kind, item_name,
               prev_value, next_value, detected_at
        FROM movements
        WHERE kind = ${kind}
        ORDER BY detected_at DESC LIMIT ${limit}
      `)
    : await db.execute(sql`
        SELECT id, scraper_id, job_id, prev_job_id, source_key, kind, item_name,
               prev_value, next_value, detected_at
        FROM movements
        ORDER BY detected_at DESC LIMIT ${limit}
      `);
  return r.rows.map(row => ({
    id: Number(row.id),
    scraperId: Number(row.scraper_id),
    jobId: Number(row.job_id),
    prevJobId: row.prev_job_id != null ? Number(row.prev_job_id) : null,
    sourceKey: String(row.source_key),
    kind: String(row.kind),
    itemName: row.item_name as string | null,
    prevValue: row.prev_value as string | null,
    nextValue: row.next_value as string | null,
    detectedAt: String(row.detected_at),
  }));
}

/**
 * Sales = removed movements grouped by item_name, ranked.
 * Returns top sellers + cumulative coverage (Pareto).
 */
export interface SalesRow {
  itemName: string;
  sold: number;
  cumulative: number;
  cumulativePct: number;
}

export async function getTopSellers(limit = 50): Promise<{ rows: SalesRow[]; totalSold: number }> {
  const r = await db.execute(sql`
    SELECT coalesce(item_name, '(unnamed)') AS item_name, count(*)::int AS sold
    FROM movements
    WHERE kind = 'removed'
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT ${limit}
  `);
  const totRes = await db.execute(sql`SELECT count(*)::int AS n FROM movements WHERE kind = 'removed'`);
  const totalSold = Number(totRes.rows[0].n);

  let cum = 0;
  const rows: SalesRow[] = (r.rows as unknown as { item_name: string; sold: number }[]).map(row => {
    const sold = Number(row.sold);
    cum += sold;
    return {
      itemName: row.item_name,
      sold,
      cumulative: cum,
      cumulativePct: totalSold > 0 ? cum / totalSold : 0,
    };
  });
  return { rows, totalSold };
}
