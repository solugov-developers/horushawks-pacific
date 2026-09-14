import { Pool, type QueryResultRow } from 'pg';

/**
 * Segunda conexão, somente leitura, ao Postgres do ERP (RDS, schema `erp.*`).
 * Separada do pool principal (Lightsail) de propósito: se o RDS travar, o pool
 * dos scrapers não fica sem conexão livre.
 *
 * - max 3 (regra de security group + role pocket_ro; o RDS é compartilhado)
 * - statement_timeout 5 s: o app tem timeout de 8 s no client
 * - connectionTimeoutMillis 5 s: RDS inalcançável vira erro rápido, não hang
 *
 * Sem ERP_DATABASE_URL configurada, erpQuery lança ErpUnavailableError; as
 * rotas tratam isso como "fonte fora" (erp: null / stale: true), nunca 500.
 * Para RDS sem CA local use `?sslmode=no-verify` na URL.
 */

export class ErpUnavailableError extends Error {
  constructor(msg = 'ERP_DATABASE_URL não configurada') {
    super(msg);
    this.name = 'ErpUnavailableError';
  }
}

declare global {
  var __erpPool: Pool | undefined;
}

function createPool(): Pool | null {
  const url = process.env.ERP_DATABASE_URL;
  if (!url) return null;
  const pool = new Pool({
    connectionString: url,
    max: 3,
    statement_timeout: 5000,
    query_timeout: 6000,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    application_name: 'horushawks-bff',
  });
  // Erro em cliente ocioso (ex.: RDS fechou a conexão) não pode derrubar o processo.
  pool.on('error', err => console.error('[erp-pool]', err.message));
  return pool;
}

let _pool: Pool | null | undefined;

export function erpPool(): Pool | null {
  if (_pool !== undefined) return _pool;
  _pool = global.__erpPool ?? createPool();
  if (process.env.NODE_ENV !== 'production' && _pool) global.__erpPool = _pool;
  return _pool;
}

export function erpConfigured(): boolean {
  return Boolean(process.env.ERP_DATABASE_URL);
}

/** SELECT parametrizado contra o RDS. Lança em timeout, rede ou URL ausente. */
export async function erpQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = erpPool();
  if (!pool) throw new ErpUnavailableError();
  const res = await pool.query<T>(text, params);
  return res.rows;
}
