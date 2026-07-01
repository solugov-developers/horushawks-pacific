'use server';

import { db } from '@/lib/db/client';
import { sql as drz } from 'drizzle-orm';
import { execReadOnly, type QueryResult, type QueryError } from '@/lib/db/exec-readonly';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export interface RunPayload {
  result: QueryResult | QueryError;
  sql: string;
  /** id da saved_query se executada de uma salva; null se ad-hoc */
  savedId: number | null;
}

/**
 * Executa SQL e atualiza last_run_* da saved_query (se id fornecido).
 * Retornar resultado direto não funciona em forms tradicionais; vamos usar
 * useActionState no client. Aqui, retornamos o payload.
 */
export async function runSqlAction(_prev: RunPayload | null, formData: FormData): Promise<RunPayload> {
  const sql = String(formData.get('sql') ?? '');
  const savedIdRaw = formData.get('savedId');
  const savedId = savedIdRaw ? Number(savedIdRaw) : null;

  const result = await execReadOnly(sql);

  if (savedId && Number.isInteger(savedId)) {
    if (result.ok) {
      await db.execute(drz`
        UPDATE saved_queries SET
          last_run_at = now(),
          last_run_ms = ${result.durationMs},
          last_row_count = ${result.rowCount},
          last_error = NULL
        WHERE id = ${savedId}
      `);
    } else {
      await db.execute(drz`
        UPDATE saved_queries SET
          last_run_at = now(),
          last_run_ms = ${result.durationMs},
          last_error = ${result.error}
        WHERE id = ${savedId}
      `);
    }
    revalidatePath('/sql');
  }

  return { result, sql, savedId };
}

/**
 * Salva uma nova query OU atualiza existente (se savedId).
 */
export async function saveQueryAction(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  const sqlText = String(formData.get('sql') ?? '').trim();
  const savedIdRaw = formData.get('savedId');
  const savedId = savedIdRaw ? Number(savedIdRaw) : null;

  if (!name) throw new Error('nome obrigatório');
  if (!sqlText) throw new Error('SQL vazio');

  let resultId: number;
  if (savedId && Number.isInteger(savedId)) {
    await db.execute(drz`
      UPDATE saved_queries SET
        name = ${name},
        description = ${description},
        sql = ${sqlText},
        updated_at = now()
      WHERE id = ${savedId}
    `);
    resultId = savedId;
  } else {
    const r = await db.execute(drz`
      INSERT INTO saved_queries (name, description, sql)
      VALUES (${name}, ${description}, ${sqlText})
      RETURNING id
    `);
    resultId = Number(r.rows[0].id);
  }

  revalidatePath('/sql');
  redirect(`/sql?id=${resultId}`);
}

/**
 * Deleta uma saved query.
 */
export async function deleteQueryAction(formData: FormData) {
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new Error('id inválido');

  await db.execute(drz`DELETE FROM saved_queries WHERE id = ${id}`);
  revalidatePath('/sql');
  redirect('/sql');
}
