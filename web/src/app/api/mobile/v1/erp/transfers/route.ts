import { NextResponse } from 'next/server';
import { withToken, bad, OPTIONS } from '@/lib/mobile/auth';
import { respondCachedOr503 } from '@/lib/mobile/cache';
import { getErpTransfers, ErpViewMissingError, TRANSFER_PERIODS } from '@/lib/queries/erp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /erp/transfers?period=30|90|365 — transferências entre lojas (contrato v2.2). 503 enquanto erp.transfers não existir. */
export const GET = withToken(async (req) => {
  const period = parseInt(req.nextUrl.searchParams.get('period') ?? '90', 10);
  if (!(TRANSFER_PERIODS as readonly number[]).includes(period)) return bad(`period deve ser um de: ${TRANSFER_PERIODS.join(', ')}`);
  try {
    return await respondCachedOr503(req, () => getErpTransfers(period));
  } catch (err) {
    if (err instanceof ErpViewMissingError) {
      return NextResponse.json({ error: 'transferências indisponíveis: view erp.transfers ainda não publicada' }, { status: 503, headers: { 'Retry-After': '3600' } });
    }
    throw err;
  }
});
