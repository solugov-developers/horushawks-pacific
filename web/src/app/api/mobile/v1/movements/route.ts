import { NextResponse } from 'next/server';
import { withToken, bad, intParam, OPTIONS } from '@/lib/mobile/auth';
import { getMobileMovements, MOVEMENT_KINDS } from '@/lib/queries/mobile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

export const GET = withToken(async (req) => {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get('kind') ?? 'all';
  if (kind !== 'all' && !(MOVEMENT_KINDS as readonly string[]).includes(kind)) {
    return bad(`kind deve ser all ou um de: ${MOVEMENT_KINDS.join(', ')}`);
  }
  return NextResponse.json(await getMobileMovements({
    kind,
    page: intParam(sp.get('page'), 1, 1, 10_000),
    pageSize: intParam(sp.get('pageSize'), 50, 1, 200),
  }));
});
