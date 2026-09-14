import { cached } from '@/lib/mobile/cache';
import { getMobileOverview } from '@/lib/queries/mobile';
import { getErpStatus, type ErpStatus } from '@/lib/queries/erp';

/**
 * Corpo do GET /status (contrato v2).
 *  - market: última coleta de cada concorrente (stale = job > 36 h), a partir
 *    do overview já existente; em falha do Postgres dos scrapers devolve o
 *    último payload bom (cache) ou null.
 *  - erp: último snapshot em erp.sales_lines (stale = snapshot > 30 h); se o
 *    RDS não responder (ou não estiver configurado) vem `erp: null`.
 *  - stale (raiz): true quando alguma parte veio de fallback ou está fora.
 * Nunca lança por fonte fora.
 */

export interface MarketStatus {
  asOf: string | null;
  sources: { slug: string; label: string; lastJobAt: string | null; stale: boolean }[];
}
export interface StatusBody {
  asOf: string;
  erp: ErpStatus | null;
  market: MarketStatus | null;
  stale: boolean;
}

async function marketStatus(): Promise<MarketStatus> {
  const o = await getMobileOverview();
  return {
    asOf: o.asOf,
    sources: o.sources.map(s => ({ slug: s.slug, label: s.label, lastJobAt: s.lastJobAt, stale: s.stale })),
  };
}

const logFail = (part: string) => (err: unknown) => {
  console.error(`[api/mobile/status] ${part} indisponível:`, err instanceof Error ? err.message : err);
  return null;
};

export async function buildStatus(): Promise<StatusBody> {
  const [market, erp] = await Promise.all([
    cached<MarketStatus>('status:market', marketStatus).catch(logFail('market')),
    // ERP: só cacheia sucesso; em falha não reaproveita payload antigo (erp: null).
    cached<ErpStatus>('status:erp', getErpStatus, { fallbackOnError: false }).catch(logFail('erp')),
  ]);

  const m = market?.body ?? null;
  const e = erp?.body ?? null;
  return {
    asOf: new Date().toISOString(),
    erp: e,
    market: m ? { asOf: m.asOf, sources: m.sources } : null,
    stale: market == null || market.stale || e == null,
  };
}
