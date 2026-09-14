import { NextResponse, type NextRequest } from 'next/server';

/**
 * Cache em memória da API mobile, por (rota + query).
 *
 * Regras (docs/arquitetura-v2.md §5b):
 *  - TTL 300 s: dentro do TTL responde do cache sem tocar no banco.
 *  - Expirou: consulta a fonte. Se a fonte falhar e existir um payload bom
 *    anterior (mesmo vencido), devolve esse payload com `stale: true`.
 *  - Sem payload anterior, o erro sobe (withToken responde 500).
 *  - Requisições simultâneas para a mesma chave compartilham uma única consulta.
 *  - `null` do fetcher (ex.: material inexistente) não é armazenado.
 *
 * O cache vive no processo do Next (um container, 250 MB); MAX_ENTRIES evita
 * crescimento sem limite com buscas arbitrárias em `q`.
 */

export const CACHE_TTL_MS = 300_000;
export const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600';
const MAX_ENTRIES = 500;

interface Entry { body: object; storedAt: number }
interface Outcome<T> { body: T; stale: boolean; fromCache: boolean }

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<Outcome<object | null>>>();

/** Chave estável: pathname + query ordenada (sem parâmetros vazios). */
export function cacheKey(req: NextRequest, extra?: string): string {
  const params = [...req.nextUrl.searchParams.entries()]
    .filter(([, v]) => v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${req.nextUrl.pathname}${extra ? '#' + extra : ''}?${params}`;
}

function remember(key: string, body: object): void {
  store.delete(key);
  store.set(key, { body, storedAt: Date.now() });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export interface CachedOptions {
  ttlMs?: number;
  /** false = em erro da fonte não devolve o último payload; o erro sobe. */
  fallbackOnError?: boolean;
}

export async function cached<T extends object>(
  key: string,
  fetcher: () => Promise<T | null>,
  opts: CachedOptions = {},
): Promise<Outcome<T | null>> {
  const ttl = opts.ttlMs ?? CACHE_TTL_MS;
  const hit = store.get(key);
  if (hit && Date.now() - hit.storedAt < ttl) {
    return { body: hit.body as T, stale: false, fromCache: true };
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<Outcome<T | null>>;

  const run = (async (): Promise<Outcome<T | null>> => {
    try {
      const fresh = await fetcher();
      if (fresh != null) remember(key, fresh);
      return { body: fresh, stale: false, fromCache: false };
    } catch (err) {
      const last = store.get(key);
      if (last && opts.fallbackOnError !== false) {
        console.error('[api/mobile] fonte falhou, servindo cache stale:', key, err instanceof Error ? err.message : err);
        return { body: { ...(last.body as T), stale: true }, stale: true, fromCache: true };
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

/** Resposta JSON com o Cache-Control da API mobile. */
export function jsonCached(body: object, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(body, init);
  res.headers.set('Cache-Control', CACHE_CONTROL);
  return res;
}

/**
 * Atalho para as rotas: cache por (rota + query) + JSON com Cache-Control.
 * Devolve null se o fetcher devolveu null (a rota decide o 404).
 */
export async function respondCached<T extends object>(
  req: NextRequest,
  fetcher: () => Promise<T | null>,
  opts: CachedOptions & { extraKey?: string } = {},
): Promise<NextResponse | null> {
  const { extraKey, ...rest } = opts;
  const out = await cached(cacheKey(req, extraKey), fetcher, rest);
  if (out.body == null) return null;
  return jsonCached(out.body);
}

/** Só para testes/diagnóstico. */
export function clearMobileCache(): void {
  store.clear();
  inflight.clear();
}
