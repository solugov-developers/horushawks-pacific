import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';
import { cached } from '@/lib/mobile/cache';

/**
 * Fotos da Pacific: a fonte própria `pacshore` (scrapers.kind = 'own') coleta
 * o catálogo público do tenant StoneProfits da Pacific e o pipeline de imagens
 * gera thumbs/<sha1>.jpg no S3 (image_assets). Aqui só o índice
 * nome do item -> URL do proxy /thumb, para cruzar com erp.stock.product.
 *
 * Regra de cruzamento (documentada em db/026_pacshore.sql): o ItemName da
 * vitrine é IGUAL ao product do ERP (mesmo tenant; 2.136/2.144 batem
 * exatamente). Chave = nome com trim + caixa baixa + espaços colapsados, que
 * cobre também diferenças de caixa/espaçamento. Sem normalizar espessura ou
 * acabamento: "2cm Taj Mahal - Premium" e "2cm Taj Mahal Leathered - Premium"
 * são produtos (e fotos) diferentes.
 */

const IMG_BASE = process.env.APP_PUBLIC_URL ?? 'https://app.horushawks.com';

export const nameKey = (s: string | null | undefined): string =>
  (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function thumbUrl(thumbKey: unknown): string | null {
  if (typeof thumbKey !== 'string') return null;
  const m = /thumbs\/([0-9a-f]+)\.jpg$/.exec(thumbKey);
  return m ? `${IMG_BASE}/api/mobile/v1/thumb/${m[1]}` : null;
}

async function loadThumbMap(): Promise<Record<string, string>> {
  const r = await db.execute(sql`
    WITH latest AS (
      SELECT s.id AS scraper_id, max(j.id) AS job_id
      FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
      WHERE s.name = 'pacshore' AND j.status = 'done'
      GROUP BY s.id
    )
    SELECT sh.item_name, (array_agg(a.thumb_key ORDER BY a.updated_at DESC))[1] AS thumb_key
    FROM slabs_history sh
    JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
    JOIN image_assets a ON a.source_url = sh.image_url AND a.status = 'done'
    WHERE sh.item_name IS NOT NULL
    GROUP BY sh.item_name
  `);
  const out: Record<string, string> = {};
  for (const row of r.rows) {
    const url = thumbUrl(row.thumb_key);
    if (url) out[nameKey(String(row.item_name))] = url;
  }
  return out;
}

/** nameKey(product) -> URL do thumb. Cacheado 5 min; em falha do banco local devolve o último mapa (ou vazio). */
export async function pacshoreThumbMap(): Promise<Record<string, string>> {
  try {
    const out = await cached<Record<string, string>>('pacshore:thumbs', loadThumbMap);
    return out.body ?? {};
  } catch (err) {
    console.error('[pacshore] thumb map indisponível:', err instanceof Error ? err.message : err);
    return {};
  }
}

/**
 * Nome "de mercado" de um produto do ERP, para casar com o item_name dos
 * concorrentes: tira espessura no início ("2cm ", "1.2cm ", "12mm "), sufixo
 * " - Premium", acabamento e formato (Leathered, Polished, Honed, Brushed,
 * Satin, Matte, Riverwashed, Flat, Jumbo) e colapsa espaços.
 *   "2cm Taj Mahal Leathered - Premium" -> "Taj Mahal"
 */
export function marketName(product: string): string {
  return product
    .replace(/^\s*\d+(?:\.\d+)?\s*(?:cm|mm)\b\s*/i, '')
    .replace(/\s*-\s*premium\s*$/i, '')
    .replace(/\b(leathered|polished|honed|brushed|satin|matte|riverwashed|flat|jumbo|suede|bookmatch(?:ed)?)\b/gi, ' ')
    .replace(/\s*-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nome canônico (como está em slabs_history) de um material dos concorrentes, ou null. */
export async function findCompetitorItemName(name: string): Promise<string | null> {
  const key = nameKey(name);
  if (!key) return null;
  const r = await db.execute(sql`
    WITH latest AS (
      SELECT s.id AS scraper_id, max(j.id) AS job_id
      FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
      WHERE j.status = 'done' AND s.enabled = true AND s.kind = 'competitor'
      GROUP BY s.id
    )
    SELECT sh.item_name, count(*)::int AS n
    FROM slabs_history sh JOIN latest l ON l.scraper_id = sh.scraper_id AND l.job_id = sh.job_id
    WHERE lower(regexp_replace(btrim(sh.item_name), '\s+', ' ', 'g')) = ${key}
    GROUP BY sh.item_name ORDER BY n DESC LIMIT 1
  `);
  return r.rows[0] ? String(r.rows[0].item_name) : null;
}
