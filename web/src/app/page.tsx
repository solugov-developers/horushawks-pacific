import { KPICard } from '@/components/kpi-card';
import { BreakdownList } from '@/components/breakdown-list';
import { SourcePicker } from '@/components/source-picker';
import { DonutChart } from '@/components/charts/donut-chart';
import { LineChart } from '@/components/charts/line-chart';
import {
  getOverviewKPIs,
  getTopCategories,
  getTopLocations,
  getSourceBreakdown,
  getJobsTimeseries,
} from '@/lib/queries/overview';
import { fmtNum, fmtPct } from '@/lib/utils';
import { findSource, ALL_SOURCES } from '@/lib/sources';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ source?: string }>;
}

export default async function OverviewPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const source = findSource(sp.source)?.slug ?? ALL_SOURCES;

  const [kpis, cats, locs, sources, jobsTs] = await Promise.all([
    getOverviewKPIs({ source }),
    getTopCategories({ source, limit: 8 }),
    getTopLocations({ source, limit: 10 }),
    getSourceBreakdown(),
    getJobsTimeseries(30),
  ]);

  const monthLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const sourceLabel =
    source === ALL_SOURCES
      ? `${kpis.scrapersCovered}/${kpis.scrapersTotal} sources active`
      : findSource(source)?.label ?? source;

  const donutData = sources.map((s) => ({ name: s.source, value: s.slabs }));
  const tsData = jobsTs.map((p) => ({ date: p.date, done: p.done, failed: p.failed }));
  const heavyOnHold = kpis.totalSlabs > 0 ? kpis.onHold / kpis.totalSlabs : 0;

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 md:px-10 py-10 md:py-14">
      <div className="mb-10 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-text-soft mb-2">Pacific Shore Stones</p>
          <h1 className="font-display text-4xl md:text-5xl leading-tight text-text-strong">Welcome back</h1>
          <p className="mt-3 text-text-muted text-base">
            {monthLabel} · {sourceLabel}
          </p>
        </div>
        <div className="text-sm text-text-muted tabular">
          {kpis.lastJobAt ? `Last sync · ${formatRelative(kpis.lastJobAt)}` : 'No data yet'}
        </div>
      </div>

      <SourcePicker basePath="/" current={source} />

      {/* Row 1: KPIs hero */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-5 md:gap-6 mb-6">
        <KPICard overline="Total slabs" value={fmtNum(kpis.totalSlabs)} caption={`${kpis.totalLocations} locations`} size="lg" />
        <KPICard overline="Categories" value={String(kpis.totalCategories)} caption="families in stock" size="lg" />
        <KPICard
          overline="On hold"
          value={kpis.totalSlabs > 0 ? fmtNum(kpis.onHold) : '—'}
          caption={kpis.totalSlabs > 0 ? `${fmtPct(heavyOnHold, 1)} of inventory` : 'flag not captured'}
          deltaTone={heavyOnHold > 0.08 ? 'negative' : 'neutral'}
          size="lg"
        />
        <KPICard
          overline="Sources"
          value={`${kpis.scrapersCovered}/${kpis.scrapersTotal}`}
          caption="active feeds"
          size="lg"
        />
      </section>

      {/* Row 2: Donut + Linha */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 mb-6">
        <ChartCard
          title="Inventory share"
          subtitle="Slabs by source — latest snapshot"
        >
          <DonutChart
            data={donutData}
            centerLabel={fmtNum(donutData.reduce((s, d) => s + d.value, 0))}
            centerSubLabel="slabs"
            height={260}
          />
        </ChartCard>

        <ChartCard
          title="Pipeline · last 30 days"
          subtitle="Scrape jobs by day"
        >
          <LineChart
            data={tsData}
            series={[
              { key: 'done', label: 'Completed', color: '#2F6E3C' },
              { key: 'failed', label: 'Failed', color: '#8C3D2E' },
            ]}
            height={260}
            xTickFormat="date-short"
          />
        </ChartCard>
      </section>

      {/* Row 3: Top categorias + Top localidades */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 mb-6">
        <BreakdownList
          title="Top categories"
          rows={cats.map((c) => ({ label: c.category, value: c.slabs }))}
        />
        <BreakdownList
          title="Top locations"
          rows={locs.map((l) => ({ label: l.location, value: l.slabs }))}
        />
      </section>

      <footer className="mt-16 text-xs text-text-soft">
        {fmtNum(kpis.totalSlabs)} slabs · {kpis.scrapersCovered} of {kpis.scrapersTotal} sources reported
      </footer>
    </main>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-5">
      <div className="mb-3">
        <h3 className="text-base font-medium text-text-strong">{title}</h3>
        {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function formatRelative(date: Date): string {
  const now = Date.now();
  const diffMin = Math.floor((now - date.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} h ago`;
  return `${Math.floor(diffHr / 24)} d ago`;
}
