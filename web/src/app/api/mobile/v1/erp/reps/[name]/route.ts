import { NextResponse } from 'next/server';
import { withToken, bad, OPTIONS } from '@/lib/mobile/auth';
import { respondCached, isSourceDown } from '@/lib/mobile/cache';
import { getErpRep, REP_PERIODS, type RepPeriod } from '@/lib/queries/erp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /erp/reps/<name URL-encoded>?period=month|year — detalhe do vendedor (contrato v2.2). 404 se não existir no período. */
export const GET = withToken<{ params: Promise<{ name: string }> }>(async (req, ctx) => {
  const { name } = await ctx.params;
  const rep = decodeURIComponent(name).trim();
  if (!rep) return bad('vendedor vazio');
  const period = req.nextUrl.searchParams.get('period') ?? 'month';
  if (!(REP_PERIODS as readonly string[]).includes(period)) return bad(`period deve ser um de: ${REP_PERIODS.join(', ')}`);
  try {
    const res = await respondCached(req, () => getErpRep(rep, period as RepPeriod), { extraKey: rep });
    if (!res) return bad('vendedor não encontrado', 404);
    return res;
  } catch (err) {
    if (!isSourceDown(err)) throw err;
    return NextResponse.json({ error: 'ERP indisponível' }, { status: 503, headers: { 'Retry-After': '60' } });
  }
});
