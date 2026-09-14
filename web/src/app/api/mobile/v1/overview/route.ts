import { withToken, OPTIONS } from '@/lib/mobile/auth';
import { respondCached } from '@/lib/mobile/cache';
import { getMobileOverview } from '@/lib/queries/mobile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

export const GET = withToken(async (req) => (await respondCached(req, getMobileOverview))!);
