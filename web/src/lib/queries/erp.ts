import { erpQuery } from '@/lib/db/erp';

/**
 * Consultas ao schema `erp.*` do RDS (views materializadas, 1 snapshot/dia).
 * Uma função por endpoint. Fase 0: só o que /status precisa.
 */

const ERP_STALE_HOURS = 30;

export interface ErpStatus { snapshot: string; loadedAt: string | null; stale: boolean }

const dayOf = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const isoOf = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Último snapshot carregado. `stale` = snapshot com mais de 30 h (a carga é
 * diária às ~06:00 BRT; 30 h cobre um dia perdido + folga).
 * Lança se o RDS não responder — quem chama decide o fallback.
 */
export async function getErpStatus(): Promise<ErpStatus | null> {
  const rows = await erpQuery<{ snapshot: unknown; loaded_at: unknown }>(
    'SELECT max(snapshot_date) AS snapshot, max(loaded_at) AS loaded_at FROM erp.sales_lines',
  );
  const snapshot = dayOf(rows[0]?.snapshot);
  if (!snapshot) return null; // view vazia: ERP ainda sem carga
  const loadedAt = isoOf(rows[0]?.loaded_at);
  // Referência de idade: loaded_at quando existe; senão o fim do dia do snapshot (UTC).
  const ref = loadedAt ? new Date(loadedAt).getTime() : new Date(snapshot + 'T23:59:59Z').getTime();
  return { snapshot, loadedAt, stale: Date.now() - ref > ERP_STALE_HOURS * 3600 * 1000 };
}
