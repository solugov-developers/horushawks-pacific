import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

export interface MaterialRow {
  itemName: string;
  slabs: number;
  qty: number;
  onHold: number;
  source: string;
}

export interface CategoryGroup {
  category: string;
  slabs: number;
  qty: number;
  onHold: number;
  materials: MaterialRow[];
}

export interface LocationGroup {
  location: string;
  slabs: number;
  qty: number;
  onHold: number;
  categories: CategoryGroup[];
}

export interface InventorySnapshot {
  scrapersCovered: number;
  scrapedAt: Date | null;
  totalSlabs: number;
  locations: LocationGroup[];
  /** A fonte aplicada ('all' ou nome do scraper) */
  source: string;
}

export async function getInventorySnapshot(opts: { source?: string } = {}): Promise<InventorySnapshot> {
  const source = opts.source && opts.source !== 'all' ? opts.source : 'all';

  const cte = source === 'all'
    ? sql`
        SELECT s.id AS scraper_id, s.name, max(j.id) AS job_id
        FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
        WHERE j.status = 'done'
        GROUP BY s.id, s.name
      `
    : sql`
        SELECT s.id AS scraper_id, s.name, max(j.id) AS job_id
        FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
        WHERE j.status = 'done' AND s.name = ${source}
        GROUP BY s.id, s.name
      `;

  // 1 query: agrega location × category × material × source
  const r = await db.execute(sql`
    WITH latest AS (${cte})
    SELECT
      coalesce(sh.location, '(unknown)')         AS location,
      coalesce(sh.category_name, '(uncategorized)') AS category,
      coalesce(sh.item_name, '(unnamed)')        AS material,
      l.name                                     AS source,
      count(*)::int                              AS slabs,
      coalesce(sum(sh.available_slabs), 0)::float AS qty,
      count(*) FILTER (WHERE sh.on_hold = true)::int AS on_hold
    FROM slabs_history sh
    JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
    GROUP BY 1, 2, 3, 4
    ORDER BY location, category, slabs DESC
  `);

  type Row = { location: string; category: string; material: string; source: string; slabs: number; qty: number; on_hold: number };
  const rows = r.rows as unknown as Row[];

  const byLocation = new Map<string, LocationGroup>();
  for (const row of rows) {
    let loc = byLocation.get(row.location);
    if (!loc) {
      loc = { location: row.location, slabs: 0, qty: 0, onHold: 0, categories: [] };
      byLocation.set(row.location, loc);
    }
    let cat = loc.categories.find(c => c.category === row.category);
    if (!cat) {
      cat = { category: row.category, slabs: 0, qty: 0, onHold: 0, materials: [] };
      loc.categories.push(cat);
    }
    cat.materials.push({
      itemName: row.material,
      source: row.source,
      slabs: Number(row.slabs),
      qty: Number(row.qty),
      onHold: Number(row.on_hold),
    });
    cat.slabs += Number(row.slabs);
    cat.qty += Number(row.qty);
    cat.onHold += Number(row.on_hold);
    loc.slabs += Number(row.slabs);
    loc.qty += Number(row.qty);
    loc.onHold += Number(row.on_hold);
  }

  const locations = [...byLocation.values()].sort((a, b) => b.slabs - a.slabs);
  for (const l of locations) {
    l.categories.sort((a, b) => b.slabs - a.slabs);
  }

  // metadata: count distinct scrapers + max finished_at
  const meta = await db.execute(sql`
    WITH latest AS (${cte})
    SELECT count(*)::int AS scrapers_covered, max(j.finished_at) AS scraped_at
    FROM latest l JOIN jobs j ON j.id = l.job_id
  `);

  return {
    scrapersCovered: Number(meta.rows[0]?.scrapers_covered ?? 0),
    scrapedAt: meta.rows[0]?.scraped_at ? new Date(meta.rows[0].scraped_at as string) : null,
    totalSlabs: locations.reduce((sum, l) => sum + l.slabs, 0),
    locations,
    source,
  };
}

export interface HeatmapCell {
  location: string;
  category: string;
  slabs: number;
}

/**
 * Matriz location × top-N categorias para heatmap.
 * Pega top categorias globais (mais comuns), depois conta por (location, category).
 */
export async function getInventoryHeatmap(opts: { topCategories?: number; topLocations?: number } = {}): Promise<{
  rows: HeatmapCell[];
  locations: string[];
  categories: string[];
}> {
  const topC = opts.topCategories ?? 8;
  const topL = opts.topLocations ?? 10;
  const r = await db.execute(sql`
    WITH latest AS (
      SELECT s.id AS scraper_id, max(j.id) AS job_id
      FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
      WHERE j.status = 'done'
      GROUP BY s.id
    ),
    snapshot AS (
      SELECT sh.location, sh.category_name AS category
      FROM slabs_history sh
      JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
      WHERE sh.location IS NOT NULL
        AND sh.category_name IS NOT NULL AND sh.category_name <> ''
    ),
    top_locations AS (
      SELECT location FROM snapshot GROUP BY 1 ORDER BY count(*) DESC LIMIT ${topL}
    ),
    top_categories AS (
      SELECT category FROM snapshot GROUP BY 1 ORDER BY count(*) DESC LIMIT ${topC}
    )
    SELECT
      s.location, s.category, count(*)::int AS slabs
    FROM snapshot s
    JOIN top_locations tl ON tl.location = s.location
    JOIN top_categories tc ON tc.category = s.category
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  const cells = r.rows.map(row => ({
    location: String(row.location),
    category: String(row.category),
    slabs: Number(row.slabs),
  }));
  const locations = Array.from(new Set(cells.map(c => c.location)));
  const categories = Array.from(new Set(cells.map(c => c.category)));
  return { rows: cells, locations, categories };
}
