import { NextResponse } from 'next/server';
import { withToken } from '@/lib/mobile/auth';
import { getMobileOverview } from '@/lib/queries/mobile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withToken(async () => NextResponse.json(await getMobileOverview()));
