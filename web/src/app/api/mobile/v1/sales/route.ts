import { withToken, bad, OPTIONS } from '@/lib/mobile/auth';
import { respondCached } from '@/lib/mobile/cache';
import { getMobileSales } from '@/lib/queries/mobile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

const PERIODS = [7, 30, 90];

export const GET = withToken(async (req) => {
  const sp = req.nextUrl.searchParams;
  const period = parseInt(sp.get('period') ?? '30', 10);
  if (!PERIODS.includes(period)) return bad('period deve ser 7, 30 ou 90');
  const source = sp.get('source');
  return (await respondCached(req, () => getMobileSales(period, source)))!;
});
