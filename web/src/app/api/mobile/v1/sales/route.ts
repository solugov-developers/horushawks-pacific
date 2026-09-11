import { NextResponse } from 'next/server';
import { withToken, bad } from '@/lib/mobile/auth';
import { getMobileSales } from '@/lib/queries/mobile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PERIODS = [7, 30, 90];

export const GET = withToken(async (req) => {
  const sp = req.nextUrl.searchParams;
  const period = parseInt(sp.get('period') ?? '30', 10);
  if (!PERIODS.includes(period)) return bad('period deve ser 7, 30 ou 90');
  return NextResponse.json(await getMobileSales(period, sp.get('source')));
});
