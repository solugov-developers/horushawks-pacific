import { withToken, bad, OPTIONS } from '@/lib/mobile/auth';
import { respondCachedOr503 } from '@/lib/mobile/cache';
import { getErpReps, REP_PERIODS, type RepPeriod } from '@/lib/queries/erp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /erp/reps?period=month|year — scorecard dos vendedores (contrato v2.2). */
export const GET = withToken(async (req) => {
  const period = req.nextUrl.searchParams.get('period') ?? 'month';
  if (!(REP_PERIODS as readonly string[]).includes(period)) return bad(`period deve ser um de: ${REP_PERIODS.join(', ')}`);
  return respondCachedOr503(req, () => getErpReps(period as RepPeriod));
});
