import { ChevronRight } from 'lucide-react';
import {
  getInventorySnapshot,
  getInventoryHeatmap,
  type CategoryGroup,
  type LocationGroup,
  type MaterialRow,
} from '@/lib/queries/inventory';
import { getLocationsGeo, getCategoriesBreakdown } from '@/lib/queries/overview';
import { SourcePicker } from '@/components/source-picker';
import { DonutChart } from '@/components/charts/donut-chart';
import { USMap } from '@/components/charts/us-map';
import { HeatmapMatrix } from '@/components/charts/heatmap-matrix';
import { fmtNum } from '@/lib/utils';
import { findSource, ALL_SOURCES } from '@/lib/sources';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ source?: string }>;
}

export default async function InventoryPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const source = findSource(sp.source)?.slug ?? ALL_SOURCES;
  const [snap, geo, heatmap, catsBreakdown] = await Promise.all([
    getInventorySnapshot({ source }),
    getLocationsGeo(),
    getInventoryHeatmap({ topCategories: 8, topLocations: 10 }),
    getCategoriesBreakdown({ source, topN: 10 }),
  ]);
  const sourceLabel = source === ALL_SOURCES ? `${snap.scrapersCovered} sources` : (findSource(source)?.label ?? source);
  const donutCats = catsBreakdown.top.map((c) => ({ name: c.category, value: c.slabs }));
  if (catsBreakdown.others.slabs > 0) {
    donutCats.push({
      name: `Other (${catsBreakdown.others.count})`,
      value: catsBreakdown.others.slabs,
    });
  }

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 md:px-10 py-10 md:py-14">
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl md:text-5xl leading-tight tracking-tight text-text-strong">Inventory</h1>
          <p className="mt-2 text-text-muted">
            {sourceLabel} · {fmtNum(snap.totalSlabs)} slabs · across {snap.locations.length} locations
          </p>
        </div>
        <div className="text-sm text-text-muted tabular">
          {snap.scrapedAt ? `As of ${formatDateTime(snap.scrapedAt)}` : 'no data yet'}
        </div>
      </header>

      <SourcePicker basePath="/inventory" current={source} />

      {snap.locations.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Mapa + Donut */}
          <section className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-5 md:gap-6 mb-6">
            <div className="rounded-2xl border border-border bg-surface px-5 py-5">
              <div className="mb-3">
                <h3 className="text-base font-medium text-text-strong">Inventory by location</h3>
                <p className="text-xs text-text-muted mt-0.5">Bubble size = slabs at that hub</p>
              </div>
              <USMap points={geo.map((g) => ({ location: g.location, slabs: g.slabs, onHold: g.onHold }))} />
            </div>
            <div className="rounded-2xl border border-border bg-surface px-5 py-5">
              <div className="mb-3">
                <h3 className="text-base font-medium text-text-strong">Top categories</h3>
                <p className="text-xs text-text-muted mt-0.5">Share of total slabs</p>
              </div>
              <DonutChart data={donutCats} centerLabel={String(catsBreakdown.totalDistinct)} centerSubLabel={catsBreakdown.totalDistinct === 1 ? 'family' : 'families'} />
            </div>
          </section>

          {/* Heatmap */}
          {heatmap.rows.length > 0 && (
            <section className="mb-6">
              <HeatmapMatrix
                title="Location × Category"
                rows={heatmap.rows}
                locations={heatmap.locations}
                categories={heatmap.categories}
              />
            </section>
          )}

          {/* Pivot detalhada */}
          <section>
            <h2 className="text-base font-medium text-text-strong mb-3">Detailed breakdown</h2>
            <PivotTable groups={snap.locations} totalSlabs={snap.totalSlabs} />
          </section>
        </>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-3xl border border-border bg-surface px-10 py-16 text-center">
      <div className="text-text-soft text-sm">No inventory yet.</div>
      <div className="mt-2 text-text-muted text-base">First scrape will populate this view.</div>
    </div>
  );
}

function PivotTable({ groups, totalSlabs }: { groups: LocationGroup[]; totalSlabs: number }) {
  return (
    <div className="rounded-3xl border border-border bg-surface overflow-hidden">
      <div className="grid grid-cols-[1fr_120px_120px_100px] items-center px-5 py-3 text-xs uppercase tracking-[0.08em] text-text-soft border-b border-border bg-surface-2/50">
        <div>Location · Category · Material</div>
        <div className="text-right tabular">Slabs</div>
        <div className="text-right tabular">Total qty</div>
        <div className="text-right tabular">% of total</div>
      </div>

      {groups.map(loc => (
        <LocationRow key={loc.location} loc={loc} total={totalSlabs} />
      ))}

      <div className="grid grid-cols-[1fr_120px_120px_100px] items-center px-5 py-3 text-sm border-t border-border bg-surface-2/50 font-medium">
        <div>Total</div>
        <div className="text-right tabular">{fmtNum(totalSlabs)}</div>
        <div className="text-right tabular text-text-muted">—</div>
        <div className="text-right tabular text-text-muted">100%</div>
      </div>
    </div>
  );
}

function LocationRow({ loc, total }: { loc: LocationGroup; total: number }) {
  const pct = total > 0 ? (loc.slabs / total) * 100 : 0;
  return (
    <details className="group border-b border-border last:border-b-0" open>
      <summary className="grid grid-cols-[1fr_120px_120px_100px] items-center px-5 py-3.5 cursor-pointer list-none hover:bg-surface-2/40 transition-colors">
        <div className="flex items-center gap-2">
          <ChevronRight className="size-4 text-text-soft transition-transform group-open:rotate-90" />
          <span className="text-base font-medium text-text-strong">{loc.location}</span>
          {loc.onHold > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-warn-bg text-warn-fg text-[10px] uppercase tracking-wider px-2 py-0.5">
              {loc.onHold} on hold
            </span>
          )}
        </div>
        <div className="text-right tabular text-base">{fmtNum(loc.slabs)}</div>
        <div className="text-right tabular text-text-muted text-sm">{fmtNum(loc.qty, { maximumFractionDigits: 0 })}</div>
        <div className="text-right tabular text-text-muted text-sm">{pct.toFixed(1)}%</div>
      </summary>

      <div className="bg-surface-2/30">
        {loc.categories.map(cat => (
          <CategoryRow key={cat.category} cat={cat} locTotal={loc.slabs} />
        ))}
      </div>
    </details>
  );
}

function CategoryRow({ cat, locTotal }: { cat: CategoryGroup; locTotal: number }) {
  const pct = locTotal > 0 ? (cat.slabs / locTotal) * 100 : 0;
  return (
    <details className="group">
      <summary className="grid grid-cols-[1fr_120px_120px_100px] items-center pl-12 pr-5 py-2.5 cursor-pointer list-none hover:bg-surface-2/60 transition-colors border-t border-border/60">
        <div className="flex items-center gap-2 text-sm">
          <ChevronRight className="size-3.5 text-text-soft transition-transform group-open:rotate-90" />
          <span>{cat.category}</span>
          {cat.onHold > 0 && (
            <span className="ml-1 inline-flex items-center rounded-full bg-warn-bg text-warn-fg text-[10px] px-1.5 py-0.5">
              {cat.onHold}
            </span>
          )}
          <span className="text-text-soft text-xs">({cat.materials.length} materials)</span>
        </div>
        <div className="text-right tabular text-sm">{fmtNum(cat.slabs)}</div>
        <div className="text-right tabular text-text-muted text-xs">{fmtNum(cat.qty, { maximumFractionDigits: 0 })}</div>
        <div className="text-right tabular text-text-muted text-xs">{pct.toFixed(1)}%</div>
      </summary>

      <ul className="bg-bg/40">
        {cat.materials.map(m => <MaterialRowView key={m.itemName} m={m} />)}
      </ul>
    </details>
  );
}

function MaterialRowView({ m }: { m: MaterialRow }) {
  return (
    <li className="grid grid-cols-[1fr_120px_120px_100px] items-center pl-20 pr-5 py-1.5 border-t border-border/40 hover:bg-surface-2/40 text-text-muted">
      <div className="flex items-center gap-2 text-xs truncate">
        <span className="truncate">{m.itemName}</span>
        {m.onHold > 0 && (
          <span className="inline-flex items-center rounded-full bg-warn-bg text-warn-fg text-[9px] px-1 py-0.5 shrink-0">
            {m.onHold} hold
          </span>
        )}
      </div>
      <div className="text-right tabular text-xs">{fmtNum(m.slabs)}</div>
      <div className="text-right tabular text-xs">{fmtNum(m.qty, { maximumFractionDigits: 0 })}</div>
      <div className="text-right tabular text-xs text-text-soft">—</div>
    </li>
  );
}

function formatDateTime(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}
