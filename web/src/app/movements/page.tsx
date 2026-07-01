import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { MovementIcon } from '@/components/movement-icon';
import { getMovementCounts, getRecentMovements } from '@/lib/queries/movements';
import { fmtNum, cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  added: 'Arrivals',
  removed: 'Sold',
  transferred: 'Transferred',
  held: 'On hold',
  released: 'Released',
  price_changed: 'Price changes',
  qty_changed: 'Qty changes',
};

interface PageProps {
  searchParams: Promise<{ kind?: string }>;
}

export default async function MovementsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const kindFilter = sp.kind || undefined;

  const [counts, items] = await Promise.all([
    getMovementCounts(),
    getRecentMovements(150, kindFilter),
  ]);
  const total = counts.reduce((s, c) => s + c.n, 0);

  if (total === 0) {
    return (
      <main className="mx-auto w-full max-w-[1280px] px-6 md:px-10 py-10 md:py-14">
        <header className="mb-10">
          <h1 className="font-display text-4xl md:text-5xl leading-tight tracking-tight">Movements</h1>
          <p className="mt-2 text-text-muted">Arrivals · Transfers · On hold · Sold</p>
        </header>
        <EmptyState
          title="No movements yet"
          description="Movements are computed by diffing two consecutive snapshots. Run the scraper a 2nd time to populate this view."
          hint="Detection includes: added · removed · price_changed · qty_changed · transferred · held · released."
        />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 md:px-10 py-10 md:py-14">
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl md:text-5xl leading-tight tracking-tight">Movements</h1>
          <p className="mt-2 text-text-muted">{fmtNum(total)} events detected · last 2 snapshots</p>
        </div>
      </header>

      {/* Kind filter chips */}
      <ul className="flex flex-wrap items-center gap-2 mb-8">
        <li>
          <Link
            href="/movements"
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm border',
              !kindFilter
                ? 'bg-accent-700 text-accent-on border-accent-700'
                : 'bg-surface text-text-muted border-border hover:bg-surface-2'
            )}
          >
            All <span className="tabular text-xs opacity-70">{fmtNum(total)}</span>
          </Link>
        </li>
        {counts.map(c => {
          const active = kindFilter === c.kind;
          return (
            <li key={c.kind}>
              <Link
                href={`/movements?kind=${c.kind}`}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm border',
                  active
                    ? 'bg-accent-700 text-accent-on border-accent-700'
                    : 'bg-surface text-text-muted border-border hover:bg-surface-2'
                )}
              >
                {KIND_LABELS[c.kind] ?? c.kind}
                <span className="tabular text-xs opacity-70">{fmtNum(c.n)}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <ul className="space-y-2">
        {items.map(m => (
          <li
            key={m.id}
            className="flex items-center gap-4 rounded-2xl border border-border bg-surface px-5 py-3.5 hover:bg-surface-2/30"
          >
            <MovementIcon kind={m.kind} />

            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="font-medium truncate">{m.itemName || '(unnamed)'}</span>
                <span className="text-xs text-text-soft tabular shrink-0">
                  · {m.sourceKey}
                </span>
              </div>
              <div className="text-xs text-text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                <span className="uppercase tracking-wider text-[10px]">{KIND_LABELS[m.kind] ?? m.kind}</span>
                {m.prevValue != null && m.nextValue != null && (
                  <>
                    <span className="text-text-soft">·</span>
                    <span className="tabular">
                      <span className="text-text-soft line-through">{m.prevValue}</span>
                      {' → '}
                      <span className="text-text">{m.nextValue}</span>
                    </span>
                  </>
                )}
                <span className="text-text-soft">·</span>
                <span className="tabular text-text-soft">job #{m.jobId}</span>
              </div>
            </div>

            <time className="text-xs text-text-soft tabular shrink-0">
              {formatRelative(new Date(m.detectedAt))}
            </time>
          </li>
        ))}
      </ul>
    </main>
  );
}

function formatRelative(date: Date): string {
  const now = Date.now();
  const diffMin = Math.floor((now - date.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffD = Math.floor(diffHr / 24);
  return `${diffD}d`;
}
