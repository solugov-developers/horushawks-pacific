import Link from 'next/link';
import { getSlabsPage, type SlabPage } from '@/lib/queries/data';
import { fmtNum, cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ source?: string; location?: string; category?: string; q?: string; hold?: string; page?: string }>;
}

export default async function DataExplorerPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filters = {
    source: sp.source || 'all',
    location: sp.location || undefined,
    category: sp.category || undefined,
    q: sp.q || undefined,
    onHold: sp.hold === '1' ? true : sp.hold === '0' ? false : undefined,
    page: Number(sp.page) || 1,
    pageSize: 50,
  };

  const data = await getSlabsPage(filters);

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 md:px-10 py-10 md:py-14">
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl md:text-5xl leading-tight tracking-tight">Data</h1>
          <p className="mt-2 text-text-muted">
            Raw browser · {fmtNum(data.total)} matching · {data.facets.sources.length} sources available
          </p>
        </div>
      </header>

      <FiltersBar data={data} />

      <div className="rounded-3xl border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2/50">
              <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-text-soft">
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium">Material</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium text-right">Slabs</th>
                <th className="px-4 py-3 font-medium text-right">Price</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={r.id} className="border-t border-border hover:bg-surface-2/40">
                  <td className="px-4 py-2.5 text-xs">
                    <span className="inline-flex items-center rounded-full bg-surface-2 text-text-muted px-2 py-0.5 text-[10px] uppercase tracking-wider">
                      {r.source}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.sourceKey || '—'}</td>
                  <td className="px-4 py-2.5 max-w-[280px] truncate" title={r.itemName ?? ''}>
                    {r.itemName || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-text-muted">{r.categoryName || '—'}</td>
                  <td className="px-4 py-2.5">{r.location || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular">{fmtNum(r.availableSlabs)}</td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {r.price != null ? `$${fmtNum(r.price, { maximumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.onHold === true && (
                      <span className="inline-flex items-center rounded-full bg-warn-bg text-warn-fg text-[10px] uppercase tracking-wider px-2 py-0.5">
                        on hold
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-text-muted">
                    No matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination total={data.total} page={data.page} pageSize={data.pageSize} sp={sp} />
    </main>
  );
}

function FiltersBar({ data }: { data: SlabPage }) {
  const f = data.filters;
  return (
    <form method="GET" className="mb-6 flex flex-wrap items-center gap-2">
      <select
        name="source"
        defaultValue={f.source ?? 'all'}
        className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong"
      >
        <option value="all">All sources</option>
        {data.facets.sources.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <select
        name="location"
        defaultValue={f.location ?? ''}
        className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong"
      >
        <option value="">All locations</option>
        {data.facets.locations.map(l => <option key={l} value={l}>{l}</option>)}
      </select>

      <select
        name="category"
        defaultValue={f.category ?? ''}
        className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong"
      >
        <option value="">All categories</option>
        {data.facets.categories.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      <select
        name="hold"
        defaultValue={f.onHold === true ? '1' : f.onHold === false ? '0' : ''}
        className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong"
      >
        <option value="">Hold: any</option>
        <option value="1">On hold only</option>
        <option value="0">Not on hold</option>
      </select>

      <input
        type="search"
        name="q"
        defaultValue={f.q ?? ''}
        placeholder="Search material or key…"
        className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm flex-1 min-w-[200px] hover:border-border-strong"
      />

      <button
        type="submit"
        className="rounded-full bg-accent-700 text-accent-on px-4 py-1.5 text-sm font-medium hover:bg-accent-600"
      >
        Apply
      </button>

      {(f.source !== 'all' || f.location || f.category || f.q || f.onHold !== undefined) && (
        <Link href="/data" className="text-sm text-text-muted hover:text-text underline-offset-2 hover:underline">
          Clear
        </Link>
      )}
    </form>
  );
}

function Pagination({ total, page, pageSize, sp }: { total: number; page: number; pageSize: number; sp: Record<string, string | undefined> }) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;

  function build(n: number) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v != null && k !== 'page') params.set(k, v);
    }
    params.set('page', String(n));
    return `?${params.toString()}`;
  }

  const prev = page > 1 ? build(page - 1) : null;
  const next = page < pages ? build(page + 1) : null;

  return (
    <div className="mt-6 flex items-center justify-between text-sm text-text-muted">
      <div>Page {page} of {pages} · {fmtNum(total)} total</div>
      <div className="flex gap-2">
        <Link href={prev ?? '#'} aria-disabled={!prev} className={cn(
          'rounded-full border border-border px-4 py-1.5',
          prev ? 'hover:bg-surface-2' : 'opacity-40 pointer-events-none'
        )}>← Prev</Link>
        <Link href={next ?? '#'} aria-disabled={!next} className={cn(
          'rounded-full border border-border px-4 py-1.5',
          next ? 'hover:bg-surface-2' : 'opacity-40 pointer-events-none'
        )}>Next →</Link>
      </div>
    </div>
  );
}
