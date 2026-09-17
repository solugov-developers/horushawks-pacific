import { db } from '@/lib/db/client';
import { sql, type SQL } from 'drizzle-orm';
import { SOURCES } from '@/lib/sources';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const EXTRA_LABELS: Record<string, string> = { thestoneindustry: 'TSI' };

export function sourceLabel(slug: string): string {
  return SOURCES.find(s => s.slug === slug)?.label
    ?? EXTRA_LABELS[slug]
    ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

const STALE_HOURS = 36;
/** Módulo Mercado = só concorrentes. A fonte própria (pacshore, kind = 'own') fica de fora. */
const COMPETITOR_IDS = sql`(SELECT id FROM scrapers WHERE kind = 'competitor')`;
export const MOVEMENT_KINDS = ['added', 'removed', 'held', 'released', 'transferred', 'price_changed', 'qty_changed'] as const;
export type MovementKind = typeof MOVEMENT_KINDS[number];

/** Último job "done" por scraper habilitado (opcionalmente só um). */
function latestCte(source?: string | null): SQL {
  const filter = source && source !== 'all' ? sql` AND s.name = ${source}` : sql``;
  return sql`
    SELECT s.id AS scraper_id, s.name, max(j.id) AS job_id
    FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
    WHERE j.status = 'done' AND s.enabled = true AND s.kind = 'competitor'${filter}
    GROUP BY s.id, s.name
  `;
}

function sourceFilter(alias: string, source?: string | null): SQL {
  return source && source !== 'all' ? sql` AND ${sql.raw(alias)}.name = ${source}` : sql``;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));
const pct = (part: number, whole: number, digits = 1) =>
  whole > 0 ? Number(((part / whole) * 100).toFixed(digits)) : 0;
const deltaPct = (cur: number, prev: number | null): number | null =>
  prev == null || prev === 0 ? null : Number((((cur - prev) / prev) * 100).toFixed(1));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const day = (v: unknown): string => String(v).slice(0, 10);
const money = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n) : String(v ?? '');
};

function movementDetail(kind: string, prev: unknown, next: unknown): string | null {
  if (kind === 'transferred' && prev && next) return `${prev} → ${next}`;
  if (kind === 'price_changed' && prev != null && next != null) return `${money(prev)} → ${money(next)}`;
  if (kind === 'qty_changed' && prev != null && next != null) return `${prev} → ${next}`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export interface OverviewSource { slug: string; label: string; slabs: number; lastJobAt: string | null; stale: boolean }
export interface Overview {
  asOf: string | null;
  totalSlabs: number; weekDeltaPct: number | null;
  sourcesCovered: number; sourcesTotal: number;
  categories: number; locations: number;
  onHold: number; onHoldPct: number;
  arrived7d: number; removed7d: number;
  sources: OverviewSource[];
}

export async function getMobileOverview(): Promise<Overview> {
  const [counts, sources, moves, weekAgo] = await Promise.all([
    db.execute(sql`
      WITH latest AS (${latestCte()})
      SELECT count(*)::int AS slabs,
             count(DISTINCT sh.location)::int AS locations,
             count(DISTINCT sh.category_name) FILTER (WHERE sh.category_name <> '')::int AS categories,
             count(*) FILTER (WHERE sh.on_hold)::int AS on_hold
      FROM slabs_history sh JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
    `),
    db.execute(sql`
      WITH latest AS (${latestCte()})
      SELECT s.name, l.job_id, j.finished_at,
             (SELECT count(*)::int FROM slabs_history sh WHERE sh.scraper_id = l.scraper_id AND sh.job_id = l.job_id) AS slabs
      FROM scrapers s
      LEFT JOIN latest l ON l.scraper_id = s.id
      LEFT JOIN jobs j ON j.id = l.job_id
      WHERE s.enabled = true AND s.kind = 'competitor'
      ORDER BY slabs DESC NULLS LAST, s.name
    `),
    db.execute(sql`
      SELECT count(*) FILTER (WHERE kind = 'added')::int AS added,
             count(*) FILTER (WHERE kind = 'removed')::int AS removed
      FROM movements WHERE detected_at > now() - interval '7 days' AND scraper_id IN ${COMPETITOR_IDS}
    `),
    db.execute(sql`
      WITH week_jobs AS (
        SELECT s.id AS scraper_id, max(j.id) AS job_id
        FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
        WHERE j.status = 'done' AND s.enabled = true AND s.kind = 'competitor' AND j.finished_at <= now() - interval '7 days'
        GROUP BY s.id
      )
      SELECT count(sh.id)::int AS slabs, count(DISTINCT w.scraper_id)::int AS scrapers
      FROM week_jobs w LEFT JOIN slabs_history sh ON sh.scraper_id = w.scraper_id AND sh.job_id = w.job_id
    `),
  ]);

  const c = counts.rows[0] ?? {};
  const staleCutoff = Date.now() - STALE_HOURS * 3600 * 1000;
  const srcRows: OverviewSource[] = sources.rows.map(r => {
    const last = iso(r.finished_at);
    return {
      slug: String(r.name), label: sourceLabel(String(r.name)),
      slabs: num(r.slabs), lastJobAt: last,
      stale: !last || new Date(last).getTime() < staleCutoff,
    };
  });
  const asOf = srcRows.reduce<string | null>((m, s) => (s.lastJobAt && (!m || s.lastJobAt > m) ? s.lastJobAt : m), null);
  const total = num(c.slabs);
  const wk = weekAgo.rows[0] ?? {};
  const weekSlabs = num(wk.scrapers) > 0 ? num(wk.slabs) : null;

  return {
    asOf,
    totalSlabs: total,
    weekDeltaPct: deltaPct(total, weekSlabs),
    sourcesCovered: srcRows.filter(s => !s.stale).length,
    sourcesTotal: srcRows.length,
    categories: num(c.categories),
    locations: num(c.locations),
    onHold: num(c.on_hold),
    onHoldPct: pct(num(c.on_hold), total),
    arrived7d: num(moves.rows[0]?.added),
    removed7d: num(moves.rows[0]?.removed),
    sources: srcRows,
  };
}

/* ------------------------------------------------------------------ */
/* Sales (vendas inferidas = movements.removed)                        */
/* ------------------------------------------------------------------ */

export interface SalesTop { itemName: string; category: string | null; sold: number; sources: string[]; cumulativePct: number }
export interface Sales {
  period: number; totalSold: number; prevTotalSold: number; deltaPct: number | null;
  distinctMaterials: number; top: SalesTop[];
  coverage: { top10: number; top25: number; top50: number };
}

export async function getMobileSales(period: number, source?: string | null): Promise<Sales> {
  const days = sql.raw(String(period));
  const sf = sourceFilter('s', source);
  const [totals, top] = await Promise.all([
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE m.detected_at > now() - interval '1 day' * ${days})::int AS cur,
        count(*) FILTER (WHERE m.detected_at <= now() - interval '1 day' * ${days}
                           AND m.detected_at >  now() - interval '1 day' * ${days} * 2)::int AS prev,
        count(DISTINCT m.item_name) FILTER (WHERE m.detected_at > now() - interval '1 day' * ${days})::int AS materials
      FROM movements m JOIN scrapers s ON s.id = m.scraper_id
      WHERE m.kind = 'removed' AND s.kind = 'competitor'${sf}
    `),
    db.execute(sql`
      SELECT coalesce(m.item_name, '(unnamed)') AS item_name,
             count(*)::int AS sold,
             array_agg(DISTINCT s.name ORDER BY s.name) AS sources,
             (SELECT sh.category_name FROM slabs_history sh
               WHERE sh.item_name = m.item_name AND sh.category_name <> ''
               ORDER BY sh.id DESC LIMIT 1) AS category
      FROM movements m JOIN scrapers s ON s.id = m.scraper_id
      WHERE m.kind = 'removed' AND s.kind = 'competitor' AND m.detected_at > now() - interval '1 day' * ${days}${sf}
      GROUP BY m.item_name
      ORDER BY sold DESC, item_name
      LIMIT 50
    `),
  ]);

  const t = totals.rows[0] ?? {};
  const totalSold = num(t.cur);
  let cum = 0;
  const rows: SalesTop[] = top.rows.map(r => {
    cum += num(r.sold);
    return {
      itemName: String(r.item_name),
      category: (r.category as string | null) ?? null,
      sold: num(r.sold),
      sources: ((r.sources as string[]) ?? []).map(sourceLabel),
      cumulativePct: pct(cum, totalSold),
    };
  });
  const covAt = (n: number) => (rows.length >= n ? rows[n - 1].cumulativePct : rows.length ? rows[rows.length - 1].cumulativePct : 0);

  return {
    period, totalSold, prevTotalSold: num(t.prev), deltaPct: deltaPct(totalSold, num(t.prev)),
    distinctMaterials: num(t.materials), top: rows,
    coverage: { top10: covAt(10), top25: covAt(25), top50: covAt(50) },
  };
}

/* ------------------------------------------------------------------ */
/* Imagem: thumb_key (S3, via image_assets) -> URL do proxy /thumb     */
/* ------------------------------------------------------------------ */
const IMG_BASE = process.env.APP_PUBLIC_URL ?? 'https://app.horushawks.com';
function thumbUrl(thumbKey: unknown): string | null {
  if (typeof thumbKey !== 'string') return null;
  const m = /thumbs\/([0-9a-f]+)\.jpg$/.exec(thumbKey);
  return m ? `${IMG_BASE}/api/mobile/v1/thumb/${m[1]}` : null;
}

/* ------------------------------------------------------------------ */
/* Inventory (snapshot atual agrupado por material)                    */
/* ------------------------------------------------------------------ */

export interface InventoryRow { itemName: string; category: string | null; slabs: number; onHold: number; sources: string[]; locations: string[]; imageUrl: string | null }
export interface Inventory {
  totalSlabs: number; totalMaterials: number; page: number; pageSize: number;
  sources: { slug: string; label: string }[]; rows: InventoryRow[];
}

export async function getMobileInventory(opts: { q?: string | null; source?: string | null; page: number; pageSize: number }): Promise<Inventory> {
  const { page, pageSize } = opts;
  const q = opts.q?.trim() ? sql` AND sh.item_name ILIKE ${'%' + opts.q.trim() + '%'}` : sql``;
  const [rows, sources] = await Promise.all([
    db.execute(sql`
      WITH latest AS (${latestCte(opts.source)}),
      grouped AS (
        SELECT coalesce(sh.item_name, '(unnamed)') AS item_name,
               mode() WITHIN GROUP (ORDER BY sh.category_name) FILTER (WHERE sh.category_name <> '') AS category,
               count(*)::int AS slabs,
               count(*) FILTER (WHERE sh.on_hold)::int AS on_hold,
               array_agg(DISTINCT l.name ORDER BY l.name) AS sources,
               array_agg(DISTINCT sh.location ORDER BY sh.location) FILTER (WHERE sh.location IS NOT NULL) AS locations,
               (array_agg(a.thumb_key) FILTER (WHERE a.thumb_key IS NOT NULL))[1] AS thumb_key
        FROM slabs_history sh JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
        LEFT JOIN image_assets a ON a.source_url = sh.image_url AND a.status = 'done'
        WHERE 1 = 1${q}
        GROUP BY sh.item_name
      )
      SELECT *, count(*) OVER ()::int AS total_materials, sum(slabs) OVER ()::int AS total_slabs
      FROM grouped
      ORDER BY slabs DESC, item_name
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
    db.execute(sql`SELECT name FROM scrapers WHERE enabled = true AND kind = 'competitor' ORDER BY name`),
  ]);
  const first = rows.rows[0];
  return {
    totalSlabs: num(first?.total_slabs), totalMaterials: num(first?.total_materials), page, pageSize,
    sources: sources.rows.map(r => ({ slug: String(r.name), label: sourceLabel(String(r.name)) })),
    rows: rows.rows.map(r => ({
      itemName: String(r.item_name), category: (r.category as string | null) ?? null,
      slabs: num(r.slabs), onHold: num(r.on_hold),
      sources: ((r.sources as string[]) ?? []).map(sourceLabel),
      locations: (r.locations as string[]) ?? [],
      imageUrl: thumbUrl(r.thumb_key),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Material detail                                                     */
/* ------------------------------------------------------------------ */

export interface HistoryRow { date: string; kind: string; count: number; source: string; location: string | null; detail: string | null }
export interface MaterialDetail {
  itemName: string; category: string | null; imageUrl: string | null;
  slabs: number; available: number; onHold: number; onHoldPct: number;
  arrived30d: number; removed30d: number;
  sources: { slug: string; label: string; slabs: number; locations: string[]; thicknesses: string[] }[];
  locations: string[]; history: HistoryRow[];
}

export async function getMobileMaterial(itemName: string): Promise<MaterialDetail | null> {
  const [perSource, moves, history] = await Promise.all([
    db.execute(sql`
      WITH latest AS (${latestCte()})
      SELECT l.name,
             count(*)::int AS slabs,
             count(*) FILTER (WHERE sh.on_hold)::int AS on_hold,
             mode() WITHIN GROUP (ORDER BY sh.category_name) FILTER (WHERE sh.category_name <> '') AS category,
             array_agg(DISTINCT sh.location ORDER BY sh.location) FILTER (WHERE sh.location IS NOT NULL) AS locations,
             array_agg(DISTINCT sh.thickness ORDER BY sh.thickness) FILTER (WHERE sh.thickness IS NOT NULL AND sh.thickness <> '') AS thicknesses,
             (array_agg(a.thumb_key) FILTER (WHERE a.thumb_key IS NOT NULL))[1] AS thumb_key
      FROM slabs_history sh JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
      LEFT JOIN image_assets a ON a.source_url = sh.image_url AND a.status = 'done'
      WHERE sh.item_name = ${itemName}
      GROUP BY l.name ORDER BY slabs DESC
    `),
    db.execute(sql`
      SELECT count(*) FILTER (WHERE kind = 'added')::int AS added,
             count(*) FILTER (WHERE kind = 'removed')::int AS removed
      FROM movements WHERE item_name = ${itemName} AND detected_at > now() - interval '30 days' AND scraper_id IN ${COMPETITOR_IDS}
    `),
    db.execute(sql`
      WITH g AS (
        SELECT m.detected_at::date AS d, m.kind, m.scraper_id, count(*)::int AS n, min(m.id) AS sample_id
        FROM movements m WHERE m.item_name = ${itemName} AND m.scraper_id IN ${COMPETITOR_IDS}
        GROUP BY 1, 2, 3
        ORDER BY d DESC, n DESC LIMIT 20
      )
      SELECT g.d, g.kind, g.n, s.name, m.prev_value, m.next_value, loc.location
      FROM g JOIN scrapers s ON s.id = g.scraper_id
      JOIN movements m ON m.id = g.sample_id
      LEFT JOIN LATERAL (
        SELECT sh.location FROM slabs_history sh
        WHERE sh.scraper_id = m.scraper_id AND sh.source_key = m.source_key
          AND sh.job_id IN (m.job_id, m.prev_job_id)
        ORDER BY sh.job_id DESC LIMIT 1
      ) loc ON true
      ORDER BY g.d DESC, g.n DESC
    `),
  ]);
  if (perSource.rows.length === 0) return null;

  const sources = perSource.rows.map(r => ({
    slug: String(r.name), label: sourceLabel(String(r.name)), slabs: num(r.slabs),
    locations: (r.locations as string[]) ?? [], thicknesses: (r.thicknesses as string[]) ?? [],
  }));
  const slabs = perSource.rows.reduce((a, r) => a + num(r.slabs), 0);
  const onHold = perSource.rows.reduce((a, r) => a + num(r.on_hold), 0);
  const category = (perSource.rows.find(r => r.category)?.category as string | undefined) ?? null;

  const imageUrl = thumbUrl(perSource.rows.map(r => r.thumb_key).find(k => k));

  return {
    itemName, category, imageUrl,
    slabs, available: slabs - onHold, onHold, onHoldPct: pct(onHold, slabs),
    arrived30d: num(moves.rows[0]?.added), removed30d: num(moves.rows[0]?.removed),
    sources,
    locations: Array.from(new Set(sources.flatMap(s => s.locations))).sort(),
    history: history.rows.map(r => ({
      date: day(r.d), kind: String(r.kind), count: num(r.n), source: sourceLabel(String(r.name)),
      location: (r.location as string | null) ?? null,
      detail: movementDetail(String(r.kind), r.prev_value, r.next_value),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Movements feed                                                      */
/* ------------------------------------------------------------------ */

export interface MovementFeedRow { id: number; date: string; kind: string; itemName: string; category: string | null; count: number; source: string; location: string | null; detail: string | null }
export interface MovementFeed { asOf: string | null; page: number; pageSize: number; total: number; rows: MovementFeedRow[] }

export async function getMobileMovements(opts: { kind?: string | null; page: number; pageSize: number }): Promise<MovementFeed> {
  const { page, pageSize } = opts;
  const kf = opts.kind && opts.kind !== 'all' ? sql` AND m.kind = ${opts.kind}` : sql``;
  const [rows, asOf] = await Promise.all([
    db.execute(sql`
      WITH g AS (
        SELECT m.detected_at::date AS d, m.kind, coalesce(m.item_name, '(unnamed)') AS item_name, m.scraper_id,
               count(*)::int AS n, min(m.id) AS sample_id
        FROM movements m WHERE m.scraper_id IN ${COMPETITOR_IDS}${kf}
        GROUP BY 1, 2, 3, 4
      ),
      pg AS (
        SELECT *, count(*) OVER ()::int AS total FROM g
        ORDER BY d DESC, n DESC, item_name
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      )
      SELECT pg.*, s.name, m.prev_value, m.next_value, loc.location, loc.category_name
      FROM pg JOIN scrapers s ON s.id = pg.scraper_id
      JOIN movements m ON m.id = pg.sample_id
      LEFT JOIN LATERAL (
        SELECT sh.location, sh.category_name FROM slabs_history sh
        WHERE sh.scraper_id = m.scraper_id AND sh.source_key = m.source_key
          AND sh.job_id IN (m.job_id, m.prev_job_id)
        ORDER BY sh.job_id DESC LIMIT 1
      ) loc ON true
      ORDER BY pg.d DESC, pg.n DESC, pg.item_name
    `),
    db.execute(sql`SELECT max(detected_at) AS as_of FROM movements WHERE scraper_id IN ${COMPETITOR_IDS}`),
  ]);
  return {
    asOf: iso(asOf.rows[0]?.as_of), page, pageSize, total: num(rows.rows[0]?.total),
    rows: rows.rows.map(r => ({
      id: num(r.sample_id), date: day(r.d), kind: String(r.kind), itemName: String(r.item_name),
      category: (r.category_name as string | null) || null, count: num(r.n),
      source: sourceLabel(String(r.name)), location: (r.location as string | null) ?? null,
      detail: movementDetail(String(r.kind), r.prev_value, r.next_value),
    })),
  };
}
