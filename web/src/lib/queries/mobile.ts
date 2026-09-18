import { db } from '@/lib/db/client';
import { sql, type SQL } from 'drizzle-orm';
import { SOURCES, EXCLUDED_CATEGORIES, sourceUnit, type SourceUnit } from '@/lib/sources';

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
/** Fora do Mercado: categorias que não são chapa (lib/sources.ts). `sh` = alias de slabs_history. */
// drizzle expande um array JS como (a, b, c) — um record —, não como text[]; por isso ARRAY[...] explícito.
const EXCL = sql`ARRAY[${sql.join(EXCLUDED_CATEGORIES.map(c => sql`${c}`), sql`, `)}]::text[]`;
const NOT_EXCLUDED_SH = sql`NOT (coalesce(sh.category_name, '') = ANY(${EXCL}))`;
/** Mesmo filtro para movements (alias m): movements.category_name é preenchida pelo worker (db/028), sem subconsulta. */
const NOT_EXCLUDED_MOV = sql`NOT (coalesce(m.category_name, '') = ANY(${EXCL}))`;
// Espessura crua (coluna da fonte ou prefixo do nome) é resolvida na matview inventory_latest.thickness_raw (db/029).
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

export interface OverviewSource { slug: string; label: string; unit: SourceUnit; slabs: number; lastJobAt: string | null; stale: boolean }
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
      SELECT count(*)::int AS slabs,
             count(DISTINCT sh.location)::int AS locations,
             count(DISTINCT sh.category_name) FILTER (WHERE sh.category_name <> '')::int AS categories,
             count(*) FILTER (WHERE sh.on_hold)::int AS on_hold
      FROM inventory_latest sh JOIN scrapers s ON s.id = sh.scraper_id
      WHERE s.enabled = true AND s.kind = 'competitor' AND ${NOT_EXCLUDED_SH}
    `),
    db.execute(sql`
      WITH latest AS (${latestCte()})
      SELECT s.name, l.job_id, j.finished_at,
             (SELECT count(*)::int FROM inventory_latest sh WHERE sh.scraper_id = s.id AND ${NOT_EXCLUDED_SH}) AS slabs
      FROM scrapers s
      LEFT JOIN latest l ON l.scraper_id = s.id
      LEFT JOIN jobs j ON j.id = l.job_id
      WHERE s.enabled = true AND s.kind = 'competitor'
      ORDER BY slabs DESC NULLS LAST, s.name
    `),
    db.execute(sql`
      SELECT count(*) FILTER (WHERE kind = 'added')::int AS added,
             count(*) FILTER (WHERE kind = 'removed')::int AS removed
      FROM movements m WHERE m.detected_at > now() - interval '7 days' AND m.scraper_id IN ${COMPETITOR_IDS} AND ${NOT_EXCLUDED_MOV}
    `),
    db.execute(sql`
      WITH week_jobs AS (
        SELECT s.id AS scraper_id, max(j.id) AS job_id
        FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
        WHERE j.status = 'done' AND s.enabled = true AND s.kind = 'competitor' AND j.finished_at <= now() - interval '7 days'
        GROUP BY s.id
      )
      SELECT count(sh.id)::int AS slabs, count(DISTINCT w.scraper_id)::int AS scrapers
      FROM week_jobs w LEFT JOIN slabs_history sh ON sh.scraper_id = w.scraper_id AND sh.job_id = w.job_id AND ${NOT_EXCLUDED_SH}
    `),
  ]);

  const c = counts.rows[0] ?? {};
  const staleCutoff = Date.now() - STALE_HOURS * 3600 * 1000;
  const srcRows: OverviewSource[] = sources.rows.map(r => {
    const last = iso(r.finished_at);
    return {
      slug: String(r.name), label: sourceLabel(String(r.name)), unit: sourceUnit(String(r.name)),
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
      WHERE m.kind = 'removed' AND s.kind = 'competitor' AND ${NOT_EXCLUDED_MOV}${sf}
    `),
    db.execute(sql`
      SELECT coalesce(m.item_name, '(unnamed)') AS item_name,
             count(*)::int AS sold,
             array_agg(DISTINCT s.name ORDER BY s.name) AS sources,
             mode() WITHIN GROUP (ORDER BY m.category_name) FILTER (WHERE coalesce(m.category_name, '') <> '') AS category
      FROM movements m JOIN scrapers s ON s.id = m.scraper_id
      WHERE m.kind = 'removed' AND s.kind = 'competitor' AND m.detected_at > now() - interval '1 day' * ${days} AND ${NOT_EXCLUDED_MOV}${sf}
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
import { thumbUrl } from '@/lib/images';

/* ------------------------------------------------------------------ */
/* Inventory (snapshot atual agrupado por material)                    */
/* ------------------------------------------------------------------ */

export interface InventoryRow { itemName: string; category: string | null; slabs: number; onHold: number; sources: string[]; locations: string[]; imageUrl: string | null }
export interface Facet { key: string; label: string; count: number }
export interface Facets { types: Facet[]; thicknesses: Facet[]; regions: Facet[]; locations: Facet[] }
export interface Inventory {
  totalSlabs: number; totalMaterials: number; page: number; pageSize: number;
  sources: { slug: string; label: string; unit: SourceUnit }[]; facets: Facets; rows: InventoryRow[];
}
export const MARKET_INVENTORY_STATUS = ['available', 'hold'] as const;
export const MARKET_INVENTORY_SORT = ['slabs', 'name'] as const;
export interface InventoryOpts {
  q?: string | null; source?: string | null; location?: string[] | null;
  type?: string[] | null; thickness?: string[] | null;
  status?: typeof MARKET_INVENTORY_STATUS[number] | null; sort?: typeof MARKET_INVENTORY_SORT[number] | null;
  page: number; pageSize: number;
}

/**
 * Espessura dos concorrentes normalizada em TS (o campo cru varia: "3", "2cm",
 * "3CM", "30mm", "12mm", "1.8", "3/4\"", "1 1/4 in"). Regra:
 *   - unidade explícita cm | mm | in/inch/"/″: mm ÷ 10, polegadas × 2.54;
 *   - sem unidade: fração = polegadas; número >= 6 = mm; senão cm;
 *   - resultado arredondado a 0,1 e formatado "N cm" ("2 cm", "1.2 cm", "1.9 cm").
 * Texto sem número no início -> null (fora do facet e do filtro).
 * O parâmetro `thickness` passa pela mesma função, então "3cm", "3 CM" e
 * "30mm" selecionam "3 cm".
 */
export function normalizeThickness(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/,/g, '.').replace(/[″”]/g, '"').replace(/\s+/g, ' ');
  const m = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)|^(\d+(?:\.\d+)?)/.exec(s);
  if (!m) return null;
  let value: number;
  let isFraction = false;
  if (m[2] && m[3]) { value = (m[1] ? Number(m[1]) : 0) + Number(m[2]) / Number(m[3]); isFraction = true; }
  else value = Number(m[4]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = /(cm|mm|in(?:ch(?:es)?)?|")/.exec(s.slice(m[0].length))?.[1]
    ?? (isFraction ? 'in' : value >= 6 ? 'mm' : 'cm');
  const cm = unit === 'mm' ? value / 10 : unit === 'cm' ? value : value * 2.54;
  const r = Math.round(cm * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} cm`;
}

/**
 * Tipos dos concorrentes: alguns scrapers prefixam "Natural"; o facet e o
 * filtro unem os pares observados (mapa explícito, sem inferência).
 */
const TYPE_ALIASES: Record<string, string> = {
  'natural granite': 'Granite',
  'natural quartzite': 'Quartzite',
  'natural marble': 'Marble',
};
export function normalizeType(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  return TYPE_ALIASES[t.toLowerCase()] ?? t;
}

const FACET_MAX = 12;
const nkey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const listOrNull = (v?: string[] | null): string[] | null => (v && v.length ? v : null);

export async function getMobileInventory(opts: InventoryOpts): Promise<Inventory> {
  const { page, pageSize } = opts;
  const q = opts.q?.trim() ? sql` AND sh.item_name ILIKE ${'%' + opts.q.trim() + '%'}` : sql``;
  const locs = listOrNull(opts.location?.filter(v => v && v !== 'all'));
  const lf = locs ? sql` AND sh.location = ANY(${locs}::text[])` : sql``;
  // base = snapshot atual filtrado por source / q / location; facets vêm daqui.
  const [rows, facetRows, sources] = await Promise.all([
    db.execute(sql`
      WITH latest AS (${latestCte(opts.source)}),
      grouped AS (
        SELECT coalesce(sh.item_name, '(unnamed)') AS item_name,
               mode() WITHIN GROUP (ORDER BY sh.category_name) FILTER (WHERE sh.category_name <> '') AS category,
               array_remove(array_agg(DISTINCT sh.thickness_raw), NULL) AS thicknesses,
               count(*)::int AS slabs,
               count(*) FILTER (WHERE sh.on_hold)::int AS on_hold,
               array_agg(DISTINCT l.name ORDER BY l.name) AS sources,
               array_agg(DISTINCT sh.location ORDER BY sh.location) FILTER (WHERE sh.location IS NOT NULL) AS locations,
               (array_agg(a.thumb_key) FILTER (WHERE a.thumb_key IS NOT NULL))[1] AS thumb_key
        FROM inventory_latest sh JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
        LEFT JOIN image_assets a ON a.source_url = sh.image_url AND a.status = 'done'
        WHERE ${NOT_EXCLUDED_SH}${q}${lf}
        GROUP BY sh.item_name
      )
      SELECT * FROM grouped ORDER BY slabs DESC, item_name
    `),
    db.execute(sql`
      WITH latest AS (${latestCte(opts.source)}),
      base AS (
        SELECT sh.category_name, sh.location, sh.thickness_raw AS thickness
        FROM inventory_latest sh JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
        WHERE ${NOT_EXCLUDED_SH}${q}${lf}
      )
      SELECT axis, key, n FROM (
        SELECT 'types' AS axis, nullif(btrim(category_name), '') AS key, count(*)::int AS n FROM base GROUP BY 2
        UNION ALL SELECT 'thicknesses', nullif(btrim(thickness), ''), count(*)::int FROM base GROUP BY 2
        UNION ALL SELECT 'locations', nullif(btrim(location), ''), count(*)::int FROM base GROUP BY 2
      ) f WHERE key IS NOT NULL
      ORDER BY axis, n DESC, key
    `),
    db.execute(sql`SELECT name FROM scrapers WHERE enabled = true AND kind = 'competitor' ORDER BY name`),
  ]);

  let all = rows.rows.map(r => ({
    row: {
      itemName: String(r.item_name), category: (r.category as string | null) ?? null,
      slabs: num(r.slabs), onHold: num(r.on_hold),
      sources: ((r.sources as string[]) ?? []).map(sourceLabel),
      locations: (r.locations as string[]) ?? [],
      imageUrl: thumbUrl(r.thumb_key),
    } satisfies InventoryRow,
    // espessuras normalizadas do material (um material pode ter 2 cm e 3 cm)
    thicknesses: [...new Set(((r.thicknesses as string[]) ?? []).map(normalizeThickness).filter((t): t is string => !!t))],
    typeKey: normalizeType(r.category as string | null),
  }));
  const types = listOrNull(opts.type?.map(t => nkey(normalizeType(t) ?? t)));
  const thick = listOrNull(opts.thickness?.map(t => normalizeThickness(t) ?? nkey(t)));
  if (types) all = all.filter(x => x.typeKey && types.includes(nkey(x.typeKey)));
  if (thick) all = all.filter(x => x.thicknesses.some(t => thick.includes(t)));
  if (opts.status === 'available') all = all.filter(x => x.row.slabs - x.row.onHold > 0);
  if (opts.status === 'hold') all = all.filter(x => x.row.onHold > 0);
  const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
  if (opts.sort === 'name') all.sort((a, b) => byName(a.row.itemName, b.row.itemName));
  else all.sort((a, b) => b.row.slabs - a.row.slabs || byName(a.row.itemName, b.row.itemName));

  // facets: normaliza a chave (tipo/espessura) e soma os contadores que caem na mesma chave
  const merged: Record<keyof Facets, Map<string, number>> = { types: new Map(), thicknesses: new Map(), regions: new Map(), locations: new Map() };
  for (const r of facetRows.rows) {
    const axis = String(r.axis) as keyof Facets;
    if (!(axis in merged)) continue;
    const raw = String(r.key);
    const key = axis === 'types' ? normalizeType(raw) : axis === 'thicknesses' ? normalizeThickness(raw) : raw;
    if (!key) continue;
    merged[axis].set(key, (merged[axis].get(key) ?? 0) + num(r.n));
  }
  const facets: Facets = { types: [], thicknesses: [], regions: [], locations: [] };
  for (const axis of Object.keys(merged) as (keyof Facets)[]) {
    facets[axis] = [...merged[axis].entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, FACET_MAX)
      .map(([key, count]) => ({ key, label: key, count }));
  }

  return {
    totalSlabs: all.reduce((n, x) => n + x.row.slabs, 0), totalMaterials: all.length, page, pageSize,
    sources: sources.rows.map(r => ({ slug: String(r.name), label: sourceLabel(String(r.name)), unit: sourceUnit(String(r.name)) })),
    facets,
    rows: all.slice((page - 1) * pageSize, page * pageSize).map(x => x.row),
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
  // Página lida pelo índice já ordenado de movements_daily (d DESC, n DESC, item_name);
  // total em consulta separada (count(*) OVER () obrigava a materializar os 70 k grupos).
  // asOf = instante da última coleta concluída dos concorrentes.
  const [rows, total, asOf] = await Promise.all([
    db.execute(sql`
      SELECT m.d, m.kind, m.item_name, m.scraper_id, m.n, m.sample_id,
             s.name, mv.prev_value, mv.next_value, loc.location, loc.category_name
      FROM movements_daily m
      JOIN scrapers s ON s.id = m.scraper_id AND s.kind = 'competitor'
      JOIN movements mv ON mv.id = m.sample_id
      LEFT JOIN LATERAL (
        SELECT sh.location, sh.category_name FROM slabs_history sh
        WHERE sh.scraper_id = mv.scraper_id AND sh.source_key = mv.source_key
          AND sh.job_id IN (mv.job_id, mv.prev_job_id)
        ORDER BY sh.job_id DESC LIMIT 1
      ) loc ON true
      WHERE ${NOT_EXCLUDED_MOV}${kf}
      ORDER BY m.d DESC, m.n DESC, m.item_name
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
    db.execute(sql`
      SELECT count(*)::int AS total FROM movements_daily m
      WHERE m.scraper_id IN ${COMPETITOR_IDS} AND ${NOT_EXCLUDED_MOV}${kf}
    `),
    // asOf = fim da última coleta concluída dos concorrentes (jobs é pequena; max em movements custava 0,6 s)
    db.execute(sql`
      SELECT max(j.finished_at) AS as_of FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
      WHERE j.status = 'done' AND s.enabled = true AND s.kind = 'competitor'
    `),
  ]);
  return {
    asOf: iso(asOf.rows[0]?.as_of), page, pageSize, total: num(total.rows[0]?.total),
    rows: rows.rows.map(r => ({
      id: num(r.sample_id), date: day(r.d), kind: String(r.kind), itemName: String(r.item_name),
      category: (r.category_name as string | null) || null, count: num(r.n),
      source: sourceLabel(String(r.name)), location: (r.location as string | null) ?? null,
      detail: movementDetail(String(r.kind), r.prev_value, r.next_value),
    })),
  };
}
