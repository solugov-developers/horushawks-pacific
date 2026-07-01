import { Pool } from 'pg';

export interface QueryResult {
  ok: true;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
}

export interface QueryError {
  ok: false;
  error: string;
  durationMs: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __pgPoolReadonly: Pool | undefined;
}

const pool = global.__pgPoolReadonly ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  // statement_timeout no client; depois reforçamos no SQL.
});
if (process.env.NODE_ENV !== 'production') global.__pgPoolReadonly = pool;

/**
 * Executa SQL ad-hoc em transação READ ONLY com timeout curto.
 *
 * Garantias:
 *  - SET TRANSACTION READ ONLY → Postgres bloqueia INSERT/UPDATE/DELETE/DDL.
 *  - statement_timeout 10s → query trava-tudo é abortada.
 *  - Sem múltiplos statements (rejeita ';' interno fora de strings).
 */
export async function execReadOnly(rawSql: string): Promise<QueryResult | QueryError> {
  const trimmed = rawSql.trim().replace(/;\s*$/, '');
  if (!trimmed) return { ok: false, error: 'SQL vazio', durationMs: 0 };

  const start = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");

    const r = await client.query(trimmed);
    await client.query('COMMIT');

    const columns = r.fields?.map(f => f.name) ?? [];
    const rows = (r.rows ?? []).slice(0, 1000); // limita exibição a 1000 rows

    return {
      ok: true,
      columns,
      rows,
      rowCount: r.rowCount ?? rows.length,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, durationMs: Date.now() - start };
  } finally {
    client.release();
  }
}
