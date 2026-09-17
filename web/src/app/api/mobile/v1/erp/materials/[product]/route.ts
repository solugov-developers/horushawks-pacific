import { NextResponse } from 'next/server';
import { withToken, bad, OPTIONS } from '@/lib/mobile/auth';
import { respondCached, isSourceDown } from '@/lib/mobile/cache';
import { getErpMaterial } from '@/lib/queries/erp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /erp/materials/<product URL-encoded> — detalhe unificado (contrato v2). 404 se o produto não existir. */
export const GET = withToken<{ params: Promise<{ product: string }> }>(async (req, ctx) => {
  const { product } = await ctx.params;
  const name = decodeURIComponent(product).trim();
  if (!name) return bad('produto vazio');
  try {
    const res = await respondCached(req, () => getErpMaterial(name), { extraKey: name });
    if (!res) return bad('produto não encontrado', 404);
    return res;
  } catch (err) {
    if (!isSourceDown(err)) throw err;
    console.error('[api/mobile] ERP indisponível sem cache:', req.nextUrl.pathname, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'ERP indisponível' }, { status: 503, headers: { 'Retry-After': '60' } });
  }
});
