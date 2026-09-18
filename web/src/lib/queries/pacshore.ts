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
 * exatamente). Três chaves, da mais estrita para a mais frouxa:
 *   1. nameKey   : trim + caixa baixa + espaços colapsados (nome exato).
 *   2. looseKey  : sem "- Premium", sem acabamento (Leathered/Honed/Polished/
 *                  Brushed/Satin/Matte/Riverwashed/Suede), sem "/", "-" e
 *                  espaços extras, MANTENDO a espessura -> mesma pedra, mesma
 *                  espessura, outro acabamento ("3cm Fantasy Brown Polished /
 *                  Leathered - Premium" -> foto de "3cm Fantasy Brown Leathered").
 *   3. stoneKey  : looseKey sem a espessura -> mesma pedra em outra espessura
 *                  ("2cm Calacatta Vagli Honed" -> foto de "3cm Calacatta Vagli").
 * A foto de capa é da pedra, então os fallbacks 2 e 3 são aceitáveis; a
 * chave exata sempre vence quando existe.
 */

import { thumbUrl } from '@/lib/images';

export const nameKey = (s: string | null | undefined): string =>
  (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const FINISHES = /\b(leathered|honed|polished|brushed|satin|matte|riverwashed|suede|bookmatch(?:ed)?)\b/gi;
const THICKNESS = /\b\d+(?:\.\d+)?\s*(?:cm|mm)\b/gi;

/** Mesma pedra e espessura, ignorando acabamento, "- Premium", "/" e "-". */
export const looseKey = (s: string | null | undefined): string =>
  nameKey(s)
    .replace(/\bpremium\b/g, ' ')
    .replace(FINISHES, ' ')
    .replace(/[\/\-_,()]+/g, ' ')
    .replace(THICKNESS, m => m.replace(/\s+/g, ''))   // "3 cm" -> "3cm"
    .replace(/\s+/g, ' ').trim();

/** Mesma pedra em qualquer espessura. */
export const stoneKey = (s: string | null | undefined): string =>
  looseKey(s).replace(THICKNESS, ' ').replace(/\s+/g, ' ').trim();

export interface ThumbIndex { exact: Record<string, string>; loose: Record<string, string>; stone: Record<string, string> }

/** URL do thumb para um produto do ERP: exato > mesma espessura > mesma pedra. */
export function thumbFor(idx: ThumbIndex, product: string): string | null {
  return idx.exact[nameKey(product)] ?? idx.loose[looseKey(product)] ?? idx.stone[stoneKey(product)] ?? null;
}


async function loadThumbMap(): Promise<ThumbIndex> {
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
  const idx: ThumbIndex = { exact: {}, loose: {}, stone: {} };
  // ordem estável por nome: nos fallbacks, o primeiro nome (alfabético) vence
  const rows = [...r.rows].sort((a, b) => String(a.item_name).localeCompare(String(b.item_name)));
  for (const row of rows) {
    const url = thumbUrl(row.thumb_key);
    if (!url) continue;
    const name = String(row.item_name);
    idx.exact[nameKey(name)] = url;
    idx.loose[looseKey(name)] ??= url;
    idx.stone[stoneKey(name)] ??= url;
  }
  return idx;
}

const EMPTY_INDEX: ThumbIndex = { exact: {}, loose: {}, stone: {} };

/** Índice de thumbs do pacshore (ver thumbFor). Cacheado 5 min; em falha do banco local devolve o último (ou vazio). */
export async function pacshoreThumbMap(): Promise<ThumbIndex> {
  try {
    const out = await cached<ThumbIndex>('pacshore:thumbs', loadThumbMap);
    return out.body ?? EMPTY_INDEX;
  } catch (err) {
    console.error('[pacshore] thumb map indisponível:', err instanceof Error ? err.message : err);
    return EMPTY_INDEX;
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
