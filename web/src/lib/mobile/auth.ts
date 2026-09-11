import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

/**
 * Auth da API mobile: `Authorization: Bearer <token>`.
 * Mesma tabela e mesmo hash (sha256 hex) que a API v1 do painel.
 */
export interface ApiToken { id: number; name: string; scopes: string[] }

export async function authenticate(req: NextRequest): Promise<ApiToken | null> {
  const header = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return null;
  const hash = createHash('sha256').update(m[1].trim()).digest('hex');
  const r = await db.execute(sql`
    SELECT id, name, scopes FROM api_tokens
    WHERE token_hash = ${hash} AND revoked_at IS NULL
    LIMIT 1
  `);
  const row = r.rows[0];
  if (!row) return null;
  db.execute(sql`UPDATE api_tokens SET last_used_at = now() WHERE id = ${Number(row.id)}`).catch(() => {});
  return { id: Number(row.id), name: String(row.name), scopes: (row.scopes as string[]) ?? [] };
}

type Handler<C> = (req: NextRequest, ctx: C, token: ApiToken) => Promise<Response>;

/** Envolve um route handler: 401 sem token válido, 500 com JSON em erro inesperado. */
export function withToken<C>(handler: Handler<C>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const token = await authenticate(req);
    if (!token) {
      return NextResponse.json({ error: 'token inválido ou ausente' }, { status: 401 });
    }
    try {
      return await handler(req, ctx, token);
    } catch (err) {
      console.error('[api/mobile]', err);
      return NextResponse.json({ error: 'erro interno' }, { status: 500 });
    }
  };
}

export function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export function intParam(v: string | null, def: number, min: number, max: number): number {
  const n = parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
