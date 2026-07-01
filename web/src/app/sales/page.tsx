import { EmptyState } from '@/components/empty-state';
import { getTopSellers } from '@/lib/queries/movements';
import { fmtNum, fmtPct } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function SalesPage() {
  const { rows, totalSold } = await getTopSellers(50);

  if (totalSold === 0) {
    return (
      <main className="mx-auto w-full max-w-[1280px] px-6 md:px-10 py-10 md:py-14">
        <header className="mb-10">
          <h1 className="font-display text-4xl md:text-5xl leading-tight tracking-tight">Sales</h1>
          <p className="mt-2 text-text-muted">Top sellers · Pareto coverage · derived from removed movements</p>
        </header>
        <EmptyState
          title="No sales detected yet"
          description="Sales are derived by diffing two consecutive snapshots — slabs that were present then disappeared. Run the scraper at least twice."
        />
      </main>
    );
  }

  // Buckets de cobertura Pareto
  const milestones = [10, 25, 50, 100].filter(n => n <= rows.length);
  const coverage = milestones.map(n => ({
    n,
    pct: rows[n - 1]?.cumulativePct ?? 0,
  }));

  const max = rows[0]?.sold ?? 1;

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 md:px-10 py-10 md:py-14">
      <header className="mb-10 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl md:text-5xl leading-tight tracking-tight">Sales</h1>
          <p className="mt-2 text-text-muted">
            {fmtNum(totalSold)} slabs sold · top {rows.length} ranked
          </p>
        </div>
      </header>

      {coverage.length > 0 && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {coverage.map(c => (
            <div key={c.n} className="rounded-2xl border border-border bg-surface px-5 py-5">
              <div className="text-[11px] uppercase tracking-[0.08em] text-text-soft">
                Top {c.n} cover
              </div>
              <div className="font-sans font-light text-4xl tabular tracking-tight text-text-strong mt-2">
                {fmtPct(c.pct, 1)}
              </div>
              <div className="text-xs text-text-muted mt-1">of total sales</div>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-3xl border border-border bg-surface overflow-hidden">
        <div className="grid grid-cols-[40px_1fr_80px_100px_100px] items-center px-5 py-3 text-xs uppercase tracking-[0.08em] text-text-soft border-b border-border bg-surface-2/50">
          <div>#</div>
          <div>Material</div>
          <div className="text-right tabular">Sold</div>
          <div className="text-right tabular">Cumul.</div>
          <div className="text-right tabular">Coverage</div>
        </div>

        {rows.map((r, i) => {
          const barPct = (r.sold / max) * 100;
          return (
            <div
              key={r.itemName + i}
              className="grid grid-cols-[40px_1fr_80px_100px_100px] items-center px-5 py-2.5 border-b border-border/60 last:border-b-0 hover:bg-surface-2/40"
            >
              <div className="text-text-soft tabular text-xs">{i + 1}</div>
              <div className="flex items-center gap-3 min-w-0">
                <span className="truncate text-sm">{r.itemName}</span>
                <div className="flex-1 h-1 bg-surface-2 rounded-full overflow-hidden min-w-[60px]">
                  <div
                    className="h-full bg-accent-700"
                    style={{ width: `${barPct.toFixed(2)}%` }}
                  />
                </div>
              </div>
              <div className="text-right tabular text-sm">{fmtNum(r.sold)}</div>
              <div className="text-right tabular text-xs text-text-muted">{fmtNum(r.cumulative)}</div>
              <div className="text-right tabular text-xs text-text-soft">
                {fmtPct(r.cumulativePct, 1)}
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
