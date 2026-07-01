import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

export interface SavedQuery {
  id: number;
  name: string;
  description: string | null;
  sql: string;
  createdAt: Date;
  updatedAt: Date;
  lastRunAt: Date | null;
  lastRunMs: number | null;
  lastRowCount: number | null;
  lastError: string | null;
}

export async function listSavedQueries(): Promise<SavedQuery[]> {
  const r = await db.execute(sql`
    SELECT id, name, description, sql, created_at, updated_at,
           last_run_at, last_run_ms, last_row_count, last_error
    FROM saved_queries
    ORDER BY updated_at DESC
  `);
  return r.rows.map(row => ({
    id: Number(row.id),
    name: String(row.name),
    description: row.description as string | null,
    sql: String(row.sql),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    lastRunAt: row.last_run_at ? new Date(row.last_run_at as string) : null,
    lastRunMs: row.last_run_ms != null ? Number(row.last_run_ms) : null,
    lastRowCount: row.last_row_count != null ? Number(row.last_row_count) : null,
    lastError: row.last_error as string | null,
  }));
}

export async function getSavedQuery(id: number): Promise<SavedQuery | null> {
  const r = await db.execute(sql`
    SELECT id, name, description, sql, created_at, updated_at,
           last_run_at, last_run_ms, last_row_count, last_error
    FROM saved_queries WHERE id = ${id}
  `);
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    id: Number(row.id),
    name: String(row.name),
    description: row.description as string | null,
    sql: String(row.sql),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    lastRunAt: row.last_run_at ? new Date(row.last_run_at as string) : null,
    lastRunMs: row.last_run_ms != null ? Number(row.last_run_ms) : null,
    lastRowCount: row.last_row_count != null ? Number(row.last_row_count) : null,
    lastError: row.last_error as string | null,
  };
}
