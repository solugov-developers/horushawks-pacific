import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';
import { erpQuery } from '@/lib/db/erp';
import { cached } from '@/lib/mobile/cache';
import { EXCLUDED_CATEGORIES, SOURCES } from '@/lib/sources';
import { lookupLocation, SOURCE_GEO, PACIFIC_STORE_COORDS, type CityCoord } from '@/lib/geo/us-cities';
import { thumbUrl } from '@/lib/images';
import { nameKey, marketName, pacshoreThumbMap, thumbFor } from '@/lib/queries/pacshore';

/**
 * Mapa de cobertura geográfica (contrato v2.3).
 *  - concorrentes: inventory_latest (snapshot atual) por (fonte, praça); fontes sem
 *    praça no payload vão para a sede (SOURCE_GEO, precision 'hq') e ganham
 *    pontos 'presence' (slabs 0); arrived7d/removed7d de movements (7 d) na praça.
 *  - Pacific: erp.stock por loja (erp.locations com region) -> PACIFIC_STORE_COORDS.
 *  - unmapped: o que não entra (Ecommerce, praça sem coordenada, depósitos/terceiros).
 */

export type Precision = 'city' | 'hq' | 'presence';
export interface MapPoint {
  id: string; kind: 'competitor' | 'pacific';
  source?: string; sourceLabel?: string; code?: string;
  city: string; state: string; lat: number; lng: number;
  slabs: number; materials: number; value?: number; arrived7d?: number; removed7d?: number;
  precision: Precision; note?: string;
}
export interface MapResponse {
  asOf: string | null; stale: boolean;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
  points: MapPoint[];
  unmapped: { source: string; label: string; slabs: number; reason: string }[];
}

const EXCL = sql`ARRAY[${sql.join(EXCLUDED_CATEGORIES.map(c => sql`${c}`), sql`, `)}]::text[]`;
const label = (slug: string) => SOURCES.find(s => s.slug === slug)?.label ?? ({ thestoneindustry: 'TSI' } as Record<string, string>)[slug] ?? slug;
const cityOf = (c: CityCoord) => c.label.split(',')[0].split(' / ')[0].split(' (')[0].trim();
const num = (v: unknown) => (v == null ? 0 : Number(v));

export async function getMap(): Promise<MapResponse> {
  const [comp, moves, pac, asOf] = await Promise.all([
    db.execute(sql`
      SELECT s.name AS source, coalesce(nullif(btrim(sh.location), ''), '') AS location,
             count(*)::int AS slabs, count(DISTINCT sh.item_name)::int AS materials
      FROM inventory_latest sh JOIN scrapers s ON s.id = sh.scraper_id
      WHERE s.enabled = true AND s.kind = 'competitor' AND NOT (coalesce(sh.category_name, '') = ANY(${EXCL}))
      GROUP BY 1, 2
    `),
    db.execute(sql`
      SELECT s.name AS source, coalesce(nullif(btrim(m.location), ''), '') AS location,
             count(*) FILTER (WHERE m.kind = 'added')::int AS added, count(*) FILTER (WHERE m.kind = 'removed')::int AS removed
      FROM movements m JOIN scrapers s ON s.id = m.scraper_id AND s.kind = 'competitor'
      WHERE m.kind IN ('added', 'removed') AND m.detected_at > now() - interval '7 days'
        AND NOT (coalesce(m.category_name, '') = ANY(${EXCL}))
      GROUP BY 1, 2
    `),
    erpQuery(`
      SELECT btrim(st.location) AS code, l.region, count(*) AS slabs, count(DISTINCT st.product) AS materials, coalesce(sum(st.asset_value), 0) AS value
      FROM erp.stock st LEFT JOIN erp.locations l ON l.code = btrim(st.location)
      WHERE coalesce(st.kind, '') !~* 'non stock' AND coalesce(st.type, '') ~* '^(slab|quartz)$' AND coalesce(btrim(st.location), '') <> ''
      GROUP BY 1, 2`).catch(err => { console.error('[map] ERP indisponível:', err instanceof Error ? err.message : err); return null; }),
    db.execute(sql`SELECT max(j.finished_at) AS as_of FROM jobs j JOIN scrapers s ON s.id = j.scraper_id WHERE j.status = 'done' AND s.kind = 'competitor'`),
  ]);

  const mv = new Map<string, { added: number; removed: number }>();
  for (const r of moves.rows) mv.set(`${r.source}|${r.location}`, { added: num(r.added), removed: num(r.removed) });
  const mvBySource = new Map<string, { added: number; removed: number }>();
  for (const [k, v] of mv) { const src = k.split('|')[0]; const a = mvBySource.get(src) ?? { added: 0, removed: 0 }; a.added += v.added; a.removed += v.removed; mvBySource.set(src, a); }

  const points: MapPoint[] = [];
  const unmapped: MapResponse['unmapped'] = [];
  // concorrentes com sede fixa: soma tudo na sede
  const hqAgg = new Map<string, { slabs: number; materials: number }>();
  for (const r of comp.rows) {
    const source = String(r.source), location = String(r.location);
    const geo = SOURCE_GEO[source];
    if (geo) {
      const a = hqAgg.get(source) ?? { slabs: 0, materials: 0 };
      a.slabs += num(r.slabs); a.materials += num(r.materials); hqAgg.set(source, a);
      continue;
    }
    const c = lookupLocation(location);
    if (!c) {
      unmapped.push({ source, label: location || '(sem praça)', slabs: num(r.slabs), reason: location === 'Ecommerce' ? 'não é praça física' : 'praça não mapeada' });
      continue;
    }
    const m = mv.get(`${source}|${location}`) ?? { added: 0, removed: 0 };
    points.push({
      id: `${source}:${location}`, kind: 'competitor', source, sourceLabel: label(source),
      city: cityOf(c), state: c.state, lat: c.lat, lng: c.lng,
      slabs: num(r.slabs), materials: num(r.materials), arrived7d: m.added, removed7d: m.removed, precision: 'city',
    });
  }
  for (const [source, geo] of Object.entries(SOURCE_GEO)) {
    const agg = hqAgg.get(source);
    const hq = lookupLocation(geo.hq);
    if (!hq) continue;
    if (agg) {
      const m = mvBySource.get(source) ?? { added: 0, removed: 0 };
      points.push({
        id: `${source}:hq`, kind: 'competitor', source, sourceLabel: label(source),
        city: cityOf(hq), state: hq.state, lat: hq.lat, lng: hq.lng,
        slabs: agg.slabs, materials: agg.materials, arrived7d: m.added, removed7d: m.removed, precision: 'hq',
        ...(geo.note ? { note: geo.note } : {}),
      });
    }
    for (const p of geo.presence ?? []) {
      const c = lookupLocation(p);
      if (c) points.push({ id: `${source}:presence:${p}`, kind: 'competitor', source, sourceLabel: label(source), city: cityOf(c), state: c.state, lat: c.lat, lng: c.lng, slabs: 0, materials: 0, precision: 'presence' });
    }
  }
  // Pacific
  if (pac) {
    for (const r of pac) {
      const code = String(r.code);
      const c = PACIFIC_STORE_COORDS[code];
      if (!c) { unmapped.push({ source: 'pacshore', label: code, slabs: num(r.slabs), reason: r.region ? 'loja sem coordenada' : 'depósito ou terceiro' }); continue; }
      points.push({ id: `pacshore:${code}`, kind: 'pacific', code, city: cityOf(c), state: c.state, lat: c.lat, lng: c.lng, slabs: num(r.slabs), materials: num(r.materials), value: Math.round(num(r.value)), precision: 'city' });
    }
  }
  points.sort((a, b) => b.slabs - a.slabs || a.id.localeCompare(b.id));
  const lats = points.map(p => p.lat), lngs = points.map(p => p.lng);
  const bounds = points.length ? { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) } : null;
  const a = asOf.rows[0]?.as_of;
  return { asOf: a ? new Date(a as string).toISOString() : null, stale: false, bounds, points, unmapped };
}

/* ---------------- /map/points/{id} ---------------- */

export interface MapPointDetail {
  id: string; kind: 'competitor' | 'pacific';
  materials: { name: string; slabs: number; imageUrl: string | null }[];
  /** só competitor: materiais da praça que a Pacific não tem (por nome normalizado) */
  gap?: { name: string; slabs: number; imageUrl: string | null }[];
}

/** Conjunto de nomes "de mercado" dos produtos de chapa da Pacific (cache 5 min). */
async function pacificStoneNames(): Promise<Set<string>> {
  const out = await cached<{ names: string[] }>('map:pacific-names', async () => {
    const rows = await erpQuery<{ product: string }>(`SELECT DISTINCT product FROM erp.stock WHERE coalesce(kind, '') !~* 'non stock' AND coalesce(type, '') ~* '^(slab|quartz)$'`);
    return { names: rows.map(r => nameKey(marketName(r.product))) };
  });
  return new Set(out.body?.names ?? []);
}

export async function getMapPoint(id: string): Promise<MapPointDetail | null> {
  const [kind, ...rest] = id.split(':');
  if (kind === 'pacshore') {
    const code = rest.join(':');
    if (!PACIFIC_STORE_COORDS[code]) return null;
    const [rows, thumbs] = await Promise.all([
      erpQuery(`SELECT product, count(*) AS slabs FROM erp.stock WHERE btrim(location) = $1 AND coalesce(kind, '') !~* 'non stock' AND coalesce(type, '') ~* '^(slab|quartz)$' GROUP BY product ORDER BY slabs DESC, product LIMIT 20`, [code]),
      pacshoreThumbMap(),
    ]);
    return { id, kind: 'pacific', materials: rows.map(r => ({ name: String(r.product), slabs: num(r.slabs), imageUrl: thumbFor(thumbs, String(r.product)) })) };
  }
  const source = kind;
  const key = rest.join(':');
  if (!SOURCES.some(s => s.slug === source) && source !== 'thestoneindustry') return null;
  const geo = SOURCE_GEO[source];
  if (key.startsWith('presence:')) return { id, kind: 'competitor', materials: [], gap: [] };
  if (geo ? key !== 'hq' : !key) return null;
  const locFilter = geo ? sql`` : sql` AND coalesce(nullif(btrim(sh.location), ''), '') = ${key}`;
  const rows = await db.execute(sql`
    SELECT sh.item_name, count(*)::int AS slabs, (array_agg(a.thumb_key) FILTER (WHERE a.thumb_key IS NOT NULL))[1] AS thumb_key
    FROM inventory_latest sh JOIN scrapers s ON s.id = sh.scraper_id
    LEFT JOIN image_assets a ON a.source_url = sh.image_url AND a.status = 'done'
    WHERE s.name = ${source} AND NOT (coalesce(sh.category_name, '') = ANY(${EXCL})) AND sh.item_name IS NOT NULL${locFilter}
    GROUP BY sh.item_name ORDER BY slabs DESC, sh.item_name LIMIT 200
  `);
  if (!rows.rows.length) return null;
  const pacific = await pacificStoneNames();
  const all = rows.rows.map(r => ({ name: String(r.item_name), slabs: num(r.slabs), imageUrl: thumbUrl(r.thumb_key) }));
  return {
    id, kind: 'competitor',
    materials: all.slice(0, 20),
    gap: all.filter(m => !pacific.has(nameKey(marketName(m.name)))).slice(0, 20),
  };
}
