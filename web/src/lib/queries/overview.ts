import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

export interface OverviewKPIs {
  totalSlabs: number;
  totalLocations: number;
  totalCategories: number;
  onHold: number;
  scrapersCovered: number;
  scrapersTotal: number;
  lastJobAt: Date | null;
}

export interface CategoryRow { category: string; slabs: number }
export interface LocationRow { location: string; slabs: number }
export interface SourceRow   { source: string; slabs: number; lastJobAt: Date | null }

interface BaseOpts {
  /** undefined ou 'all' = todas as fontes */
  source?: string;
}

/**
 * Retorna a query SQL `latest_jobs` (CTE) — par scraper_id, job_id do último done.
 * Quando `source` é especificado, filtra pelo nome.
 */
function latestJobsCte(source?: string) {
  if (source && source !== 'all') {
    return sql`
      SELECT s.id AS scraper_id, max(j.id) AS job_id
      FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
      WHERE j.status = 'done' AND s.name = ${source}
      GROUP BY s.id
    `;
  }
  return sql`
    SELECT s.id AS scraper_id, max(j.id) AS job_id
    FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
    WHERE j.status = 'done'
    GROUP BY s.id
  `;
}

export async function getOverviewKPIs(opts: BaseOpts = {}): Promise<OverviewKPIs> {
  const cte = latestJobsCte(opts.source);
  const r = await db.execute(sql`
    WITH latest AS (${cte}),
    counts AS (
      SELECT
        count(*)::int                                        AS total_slabs,
        count(DISTINCT sh.location)::int                     AS total_locations,
        count(DISTINCT sh.category_name)::int                AS total_categories,
        count(*) FILTER (WHERE sh.on_hold = true)::int       AS on_hold
      FROM slabs_history sh
      JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
    ),
    coverage AS (
      SELECT count(*)::int AS scrapers_covered FROM latest
    ),
    total AS (
      SELECT count(*)::int AS scrapers_total FROM scrapers WHERE enabled = true
    ),
    last_at AS (
      SELECT max(j.finished_at) AS last_job_at
      FROM jobs j
      JOIN latest l ON l.job_id = j.id
    )
    SELECT * FROM counts, coverage, total, last_at
  `);
  const row = r.rows[0];
  return {
    totalSlabs: Number(row.total_slabs ?? 0),
    totalLocations: Number(row.total_locations ?? 0),
    totalCategories: Number(row.total_categories ?? 0),
    onHold: Number(row.on_hold ?? 0),
    scrapersCovered: Number(row.scrapers_covered ?? 0),
    scrapersTotal: Number(row.scrapers_total ?? 0),
    lastJobAt: row.last_job_at ? new Date(row.last_job_at as string) : null,
  };
}

export async function getTopCategories(opts: BaseOpts & { limit?: number } = {}): Promise<CategoryRow[]> {
  const limit = opts.limit ?? 8;
  const cte = latestJobsCte(opts.source);
  const r = await db.execute(sql`
    WITH latest AS (${cte})
    SELECT sh.category_name AS category, count(*)::int AS slabs
    FROM slabs_history sh
    JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
    WHERE sh.category_name IS NOT NULL AND sh.category_name <> ''
    GROUP BY 1 ORDER BY 2 DESC LIMIT ${limit}
  `);
  return r.rows.map(row => ({ category: String(row.category), slabs: Number(row.slabs) }));
}

export interface CategoriesBreakdown {
  top: CategoryRow[];
  others: { slabs: number; count: number };
  totalDistinct: number;
  totalSlabs: number;
}

/**
 * Retorna as top-N categorias + resto agregado como "Others" +
 * total real de categorias distintas (pra usar no centro do donut).
 */
export async function getCategoriesBreakdown(
  opts: BaseOpts & { topN?: number } = {},
): Promise<CategoriesBreakdown> {
  const topN = opts.topN ?? 10;
  const cte = latestJobsCte(opts.source);
  const r = await db.execute(sql`
    WITH latest AS (${cte}),
    per_cat AS (
      SELECT sh.category_name AS category, count(*)::int AS slabs
      FROM slabs_history sh
      JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
      WHERE sh.category_name IS NOT NULL AND sh.category_name <> ''
      GROUP BY 1
    )
    SELECT category, slabs FROM per_cat ORDER BY slabs DESC
  `);
  const all = r.rows.map((row) => ({
    category: String(row.category),
    slabs: Number(row.slabs),
  }));
  const totalSlabs = all.reduce((s, x) => s + x.slabs, 0);
  const top = all.slice(0, topN);
  const rest = all.slice(topN);
  return {
    top,
    others: { slabs: rest.reduce((s, x) => s + x.slabs, 0), count: rest.length },
    totalDistinct: all.length,
    totalSlabs,
  };
}

export async function getTopLocations(opts: BaseOpts & { limit?: number } = {}): Promise<LocationRow[]> {
  const limit = opts.limit ?? 10;
  const cte = latestJobsCte(opts.source);
  const r = await db.execute(sql`
    WITH latest AS (${cte})
    SELECT sh.location, count(*)::int AS slabs
    FROM slabs_history sh
    JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
    WHERE sh.location IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT ${limit}
  `);
  return r.rows.map(row => ({ location: String(row.location), slabs: Number(row.slabs) }));
}

export interface JobsTimeseriesPoint {
  /** ISO date (YYYY-MM-DD) */
  date: string;
  done: number;
  failed: number;
  total: number;
}

/**
 * Volume de jobs por dia nos últimos N dias (default 30).
 * Retorna pontos para todos os dias do range (zero quando sem jobs).
 */
export async function getJobsTimeseries(days = 30): Promise<JobsTimeseriesPoint[]> {
  const r = await db.execute(sql`
    WITH day_series AS (
      SELECT generate_series(
        date_trunc('day', now() - (${days - 1} || ' days')::interval),
        date_trunc('day', now()),
        '1 day'::interval
      )::date AS d
    ),
    counts AS (
      SELECT
        date_trunc('day', j.started_at)::date AS d,
        count(*) FILTER (WHERE j.status = 'done')::int   AS done,
        count(*) FILTER (WHERE j.status = 'failed')::int AS failed,
        count(*)::int AS total
      FROM jobs j
      WHERE j.started_at >= now() - (${days} || ' days')::interval
      GROUP BY 1
    )
    SELECT
      ds.d AS date,
      coalesce(c.done, 0)   AS done,
      coalesce(c.failed, 0) AS failed,
      coalesce(c.total, 0)  AS total
    FROM day_series ds
    LEFT JOIN counts c ON c.d = ds.d
    ORDER BY ds.d
  `);
  return r.rows.map(row => ({
    date: String(row.date).slice(0, 10),
    done: Number(row.done),
    failed: Number(row.failed),
    total: Number(row.total),
  }));
}

export interface LocationGeo {
  location: string;
  slabs: number;
  onHold: number;
}

/**
 * Slabs por localidade na última snapshot, com flag on_hold.
 * Inclui Ecommerce / sem location pra agregação separada.
 */
export async function getLocationsGeo(): Promise<LocationGeo[]> {
  const r = await db.execute(sql`
    WITH latest AS (
      SELECT s.id AS scraper_id, max(j.id) AS job_id
      FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
      WHERE j.status = 'done'
      GROUP BY s.id
    )
    SELECT
      coalesce(sh.location, '(no location)') AS location,
      count(*)::int                          AS slabs,
      count(*) FILTER (WHERE sh.on_hold)::int AS on_hold
    FROM slabs_history sh
    JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
    GROUP BY 1
    ORDER BY 2 DESC
  `);
  return r.rows.map(row => ({
    location: String(row.location),
    slabs: Number(row.slabs),
    onHold: Number(row.on_hold),
  }));
}

export async function getSourceBreakdown(): Promise<SourceRow[]> {
  const r = await db.execute(sql`
    WITH latest AS (
      SELECT s.id AS scraper_id, s.name, max(j.id) AS job_id
      FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
      WHERE j.status = 'done'
      GROUP BY s.id, s.name
    )
    SELECT
      l.name AS source,
      coalesce(count(sh.id), 0)::int AS slabs,
      max(j.finished_at) AS last_job_at
    FROM scrapers s
    LEFT JOIN latest l ON l.scraper_id = s.id
    LEFT JOIN slabs_history sh ON sh.scraper_id = l.scraper_id AND sh.job_id = l.job_id
    LEFT JOIN jobs j ON j.id = l.job_id
    WHERE s.enabled = true
    GROUP BY l.name, s.id
    ORDER BY 2 DESC NULLS LAST, s.id
  `);
  return r.rows.map(row => ({
    source: String(row.source ?? '(no data)'),
    slabs: Number(row.slabs ?? 0),
    lastJobAt: row.last_job_at ? new Date(row.last_job_at as string) : null,
  }));
}
