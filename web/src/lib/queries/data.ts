import { db } from '@/lib/db/client';
import { sql, type SQL } from 'drizzle-orm';

export interface SlabRow {
  id: number;
  source: string;
  scrapedAt: string;
  sourceKey: string | null;
  itemName: string | null;
  categoryName: string | null;
  location: string | null;
  availableSlabs: number | null;
  price: number | null;
  onHold: boolean | null;
}

export interface SlabPage {
  rows: SlabRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: SlabFilters;
  facets: {
    sources: string[];
    locations: string[];
    categories: string[];
  };
}

export interface SlabFilters {
  source?: string;     // 'all' or scraper name
  location?: string;
  category?: string;
  q?: string;
  onHold?: boolean;
  page: number;
  pageSize: number;
}

/**
 * Browse de slabs unified — usa slabs_history filtrado pelos últimos jobs done.
 */
export async function getSlabsPage(filters: SlabFilters): Promise<SlabPage> {
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize || 50));
  const offset = (page - 1) * pageSize;

  const sourceFilter = filters.source && filters.source !== 'all' ? filters.source : null;

  const latestCte = sourceFilter
    ? sql`SELECT s.id AS scraper_id, s.name, max(j.id) AS job_id
          FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
          WHERE j.status='done' AND s.name = ${sourceFilter}
          GROUP BY s.id, s.name`
    : sql`SELECT s.id AS scraper_id, s.name, max(j.id) AS job_id
          FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
          WHERE j.status='done'
          GROUP BY s.id, s.name`;

  const conds: SQL[] = [];
  if (filters.location) conds.push(sql`sh.location = ${filters.location}`);
  if (filters.category) conds.push(sql`sh.category_name = ${filters.category}`);
  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(sql`(sh.item_name ILIKE ${like} OR sh.source_key ILIKE ${like})`);
  }
  if (filters.onHold === true)  conds.push(sql`sh.on_hold = true`);
  if (filters.onHold === false) conds.push(sql`(sh.on_hold = false OR sh.on_hold IS NULL)`);

  const whereExtra = conds.length > 0 ? sql` AND ${sql.join(conds, sql` AND `)}` : sql``;

  const [rowsRes, countRes, facetSrcRes, facetLocRes, facetCatRes] = await Promise.all([
    db.execute(sql`
      WITH latest AS (${latestCte})
      SELECT sh.id, l.name AS source, sh.scraped_at, sh.source_key,
             sh.item_name, sh.category_name, sh.location,
             sh.available_slabs, sh.price::float AS price, sh.on_hold
      FROM slabs_history sh
      JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
      WHERE 1 = 1 ${whereExtra}
      ORDER BY sh.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
    db.execute(sql`
      WITH latest AS (${latestCte})
      SELECT count(*)::int AS n
      FROM slabs_history sh
      JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
      WHERE 1 = 1 ${whereExtra}
    `),
    db.execute(sql`SELECT name FROM scrapers WHERE enabled = true ORDER BY id`),
    db.execute(sql`
      WITH latest AS (${latestCte})
      SELECT DISTINCT sh.location FROM slabs_history sh
      JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
      WHERE sh.location IS NOT NULL ORDER BY 1
    `),
    db.execute(sql`
      WITH latest AS (${latestCte})
      SELECT DISTINCT sh.category_name FROM slabs_history sh
      JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
      WHERE sh.category_name IS NOT NULL AND sh.category_name <> '' ORDER BY 1
    `),
  ]);

  return {
    rows: rowsRes.rows.map(r => ({
      id: Number(r.id),
      source: String(r.source),
      scrapedAt: String(r.scraped_at),
      sourceKey: r.source_key as string | null,
      itemName: r.item_name as string | null,
      categoryName: r.category_name as string | null,
      location: r.location as string | null,
      availableSlabs: r.available_slabs != null ? Number(r.available_slabs) : null,
      price: r.price != null ? Number(r.price) : null,
      onHold: r.on_hold as boolean | null,
    })),
    total: Number(countRes.rows[0].n),
    page,
    pageSize,
    filters,
    facets: {
      sources: facetSrcRes.rows.map(r => String(r.name)),
      locations: facetLocRes.rows.map(r => String(r.location)),
      categories: facetCatRes.rows.map(r => String(r.category_name)),
    },
  };
}
