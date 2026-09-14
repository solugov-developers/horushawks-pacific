import { NextResponse } from 'next/server';
import { withToken, intParam, OPTIONS } from '@/lib/mobile/auth';
import { getMobileInventory } from '@/lib/queries/mobile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

export const GET = withToken(async (req) => {
  const sp = req.nextUrl.searchParams;
  return NextResponse.json(await getMobileInventory({
    q: sp.get('q'),
    source: sp.get('source'),
    page: intParam(sp.get('page'), 1, 1, 10_000),
    pageSize: intParam(sp.get('pageSize'), 50, 1, 200),
  }));
});
