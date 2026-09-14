/* eslint-disable @typescript-eslint/no-explicit-any */
// Rodar: cd web && npx -y tsx --tsconfig tsconfig.json scripts/test-fase0.mts
// Teste isolado da fase 0 (sem banco): cache + status com fontes fora.
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import * as cacheMod from '@/lib/mobile/cache';
// interop CJS/ESM do tsx: exports podem vir em .default
const ns = (m: unknown) => { const o = m as { default?: Record<string, unknown> } & Record<string, unknown>; return (o.default && 'cached' in o.default ? o.default : o) as Record<string, any>; };
const { cached, cacheKey, clearMobileCache, jsonCached, CACHE_CONTROL } = ns(cacheMod);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// 1) cacheKey ordena a query e ignora vazios
{
  const a = cacheKey(new NextRequest('http://x/api/mobile/v1/inventory?page=1&q=taj&source='));
  const b = cacheKey(new NextRequest('http://x/api/mobile/v1/inventory?q=taj&page=1'));
  assert.equal(a, b);
  assert.equal(a, '/api/mobile/v1/inventory?page=1&q=taj');
}

// 2) TTL: 2ª chamada dentro do TTL não toca a fonte
{
  clearMobileCache();
  let calls = 0;
  const f = async () => ({ calls: ++calls });
  const r1 = await cached('k', f); const r2 = await cached('k', f);
  assert.equal(calls, 1); assert.equal(r1.fromCache, false); assert.equal(r2.fromCache, true);
  assert.deepEqual(r2.body, { calls: 1 }); assert.equal('stale' in (r2.body as object), false);
}

// 3) Expirou + fonte falhou => último payload bom com stale: true
{
  clearMobileCache();
  await cached('k2', async () => ({ v: 'good' }), { ttlMs: 1 });
  await sleep(5);
  const r = await cached('k2', async () => { throw new Error('db down'); }, { ttlMs: 1 });
  assert.deepEqual(r.body, { v: 'good', stale: true }); assert.equal(r.stale, true);
}

// 4) fallbackOnError:false => erro sobe; sem payload anterior => erro sobe
{
  clearMobileCache();
  await cached('k3', async () => ({ v: 1 }), { ttlMs: 1 }); await sleep(5);
  await assert.rejects(cached('k3', async () => { throw new Error('x'); }, { ttlMs: 1, fallbackOnError: false }));
  await assert.rejects(cached('k4', async () => { throw new Error('x'); }));
}

// 5) null não é armazenado; single-flight
{
  clearMobileCache();
  let n = 0;
  const r = await cached('k5', async () => { n++; return null; });
  assert.equal(r.body, null); await cached('k5', async () => { n++; return null; }); assert.equal(n, 2);
  let m = 0;
  const slow = async () => { m++; await sleep(20); return { m }; };
  const [x, y] = await Promise.all([cached('k6', slow), cached('k6', slow)]);
  assert.equal(m, 1); assert.deepEqual(x.body, y.body);
}

// 6) header Cache-Control
{
  const res = jsonCached({ ok: true });
  assert.equal(res.headers.get('Cache-Control'), CACHE_CONTROL);
  assert.equal(CACHE_CONTROL, 'public, max-age=300, stale-while-revalidate=3600');
}

// 7) /status com as duas fontes fora: erp null, market null, stale true, sem throw
{
  process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:1/x';            // porta fechada
  process.env.ERP_DATABASE_URL = 'postgres://u:p@127.0.0.1:1/x?sslmode=no-verify';
  const sm = await import('@/lib/mobile/status') as any; const buildStatus = (sm.default?.buildStatus ?? sm.buildStatus) as () => Promise<any>;
  const t0 = Date.now();
  const s = await buildStatus();
  assert.equal(s.erp, null); assert.equal(s.market, null); assert.equal(s.stale, true);
  assert.ok(typeof s.asOf === 'string' && !Number.isNaN(Date.parse(s.asOf)));
  console.log('status com fontes fora ->', JSON.stringify(s), `(${Date.now() - t0} ms)`);
}

// 8) erpQuery sem ERP_DATABASE_URL => ErpUnavailableError (não 500 no /status, vira erp: null)
{
  delete process.env.ERP_DATABASE_URL;
  const em = await import('@/lib/db/erp') as any; const mod = em.default?.erpConfigured ? em.default : em;
  // pool já foi memoizado como configurado no passo 7 nesse processo; testa só a flag
  assert.equal(mod.erpConfigured(), false);
}

console.log('OK: todos os testes da fase 0 passaram');
