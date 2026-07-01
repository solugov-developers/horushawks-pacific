import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

export interface ScraperRow {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  schedule: string | null;
  lastJobId: number | null;
  lastJobStatus: string | null;
  lastJobAt: Date | null;
  lastRowsInserted: number | null;
  totalDoneJobs: number;
  totalSlabsLatest: number;
}

export async function getScrapersOverview(): Promise<ScraperRow[]> {
  const r = await db.execute(sql`
    WITH last_jobs AS (
      SELECT DISTINCT ON (scraper_id)
             scraper_id, id AS job_id, status, finished_at, rows_inserted
      FROM jobs
      ORDER BY scraper_id, id DESC
    ),
    counts AS (
      SELECT scraper_id, count(*)::int AS n FROM jobs WHERE status='done' GROUP BY 1
    ),
    latest_done AS (
      SELECT scraper_id, max(id) AS job_id FROM jobs WHERE status='done' GROUP BY 1
    ),
    latest_counts AS (
      SELECT ld.scraper_id, count(sh.id)::int AS slabs
      FROM latest_done ld
      LEFT JOIN slabs_history sh ON sh.scraper_id = ld.scraper_id AND sh.job_id = ld.job_id
      GROUP BY ld.scraper_id
    )
    SELECT
      s.id, s.name, s.description, s.enabled, s.schedule,
      lj.job_id        AS last_job_id,
      lj.status        AS last_job_status,
      lj.finished_at   AS last_job_at,
      lj.rows_inserted AS last_rows_inserted,
      coalesce(c.n, 0)         AS total_done_jobs,
      coalesce(lc.slabs, 0)    AS total_slabs_latest
    FROM scrapers s
    LEFT JOIN last_jobs lj      ON lj.scraper_id = s.id
    LEFT JOIN counts c          ON c.scraper_id = s.id
    LEFT JOIN latest_counts lc  ON lc.scraper_id = s.id
    ORDER BY s.id
  `);

  return r.rows.map(row => ({
    id: Number(row.id),
    name: String(row.name),
    description: row.description as string | null,
    enabled: Boolean(row.enabled),
    schedule: row.schedule as string | null,
    lastJobId: row.last_job_id != null ? Number(row.last_job_id) : null,
    lastJobStatus: row.last_job_status as string | null,
    lastJobAt: row.last_job_at ? new Date(row.last_job_at as string) : null,
    lastRowsInserted: row.last_rows_inserted != null ? Number(row.last_rows_inserted) : null,
    totalDoneJobs: Number(row.total_done_jobs),
    totalSlabsLatest: Number(row.total_slabs_latest),
  }));
}

export interface ScraperHealth {
  name: string;
  doneLastN: number;
  failedLastN: number;
  avgDurationSec: number | null;
  successPct: number;
}

/**
 * Saúde dos scrapers nos últimos N dias (default 7):
 * - quantos jobs done vs failed
 * - duração média (segundos)
 * - taxa de sucesso
 */
export async function getScrapersHealth(days = 7): Promise<ScraperHealth[]> {
  const r = await db.execute(sql`
    WITH window_jobs AS (
      SELECT j.*, s.name
      FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
      WHERE j.started_at >= now() - (${days} || ' days')::interval
        AND s.enabled = true
    )
    SELECT
      name,
      count(*) FILTER (WHERE status = 'done')::int   AS done_n,
      count(*) FILTER (WHERE status = 'failed')::int AS failed_n,
      avg(EXTRACT(EPOCH FROM (finished_at - started_at)))
        FILTER (WHERE status = 'done' AND finished_at IS NOT NULL) AS avg_dur
    FROM window_jobs
    GROUP BY name
    ORDER BY name
  `);
  return r.rows.map(row => {
    const done = Number(row.done_n ?? 0);
    const failed = Number(row.failed_n ?? 0);
    const total = done + failed;
    return {
      name: String(row.name),
      doneLastN: done,
      failedLastN: failed,
      avgDurationSec: row.avg_dur != null ? Number(row.avg_dur) : null,
      successPct: total > 0 ? done / total : 0,
    };
  });
}

export interface ScraperDurationPoint {
  date: string;
  name: string;
  avgSec: number;
}

/**
 * Duração média por scraper por dia (últimos N dias).
 * Usado em line chart com múltiplas linhas (uma por scraper).
 */
export async function getScraperDurationTimeseries(days = 14): Promise<ScraperDurationPoint[]> {
  const r = await db.execute(sql`
    SELECT
      date_trunc('day', j.started_at)::date AS d,
      s.name,
      avg(EXTRACT(EPOCH FROM (j.finished_at - j.started_at)))::int AS avg_sec
    FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
    WHERE j.status = 'done'
      AND j.started_at >= now() - (${days} || ' days')::interval
      AND j.finished_at IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  return r.rows.map(row => ({
    date: String(row.d).slice(0, 10),
    name: String(row.name),
    avgSec: Number(row.avg_sec ?? 0),
  }));
}
