import { withToken, OPTIONS } from '@/lib/mobile/auth';
import { jsonCached } from '@/lib/mobile/cache';
import { buildStatus } from '@/lib/mobile/status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export { OPTIONS };

/** GET /status — saúde das fontes (mercado + ERP). Ver lib/mobile/status.ts. */
export const GET = withToken(async () => jsonCached(await buildStatus()));
