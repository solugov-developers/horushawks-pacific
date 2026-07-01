import Link from 'next/link';
import { Plus, Clock, AlertCircle } from 'lucide-react';
import { listSavedQueries, getSavedQuery } from '@/lib/queries/saved';
import { SqlRunner } from './sql-runner';
import { fmtNum, cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

export default async function SqlPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const id = sp.id ? Number(sp.id) : null;

  const [savedList, current] = await Promise.all([
    listSavedQueries(),
    id ? getSavedQuery(id) : Promise.resolve(null),
  ]);

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 md:px-10 py-10 md:py-14">
      <header className="mb-10">
        <h1 className="font-display text-4xl md:text-5xl leading-tight tracking-tight">SQL</h1>
        <p className="mt-2 text-text-muted">
          Editor read-only · execução em transação isolada · {savedList.length} queries salvas
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Sidebar: saved queries */}
        <aside className="space-y-2 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-medium text-text-strong">Saved queries</h2>
            <Link
              href="/sql"
              className={cn(
                'inline-flex items-center gap-1 rounded-full text-xs px-2.5 py-1 border',
                !current ? 'bg-accent-700 text-accent-on border-accent-700' : 'border-border text-text-muted hover:bg-surface-2'
              )}
            >
              <Plus className="size-3" />
              New
            </Link>
          </div>

          <ul className="space-y-1">
            {savedList.map(q => {
              const active = current?.id === q.id;
              return (
                <li key={q.id}>
                  <Link
                    href={`/sql?id=${q.id}`}
                    className={cn(
                      'block rounded-lg px-3 py-2 transition-colors',
                      active
                        ? 'bg-accent-700/10 dark:bg-accent-400/10 border border-accent-700/20 dark:border-accent-400/20'
                        : 'hover:bg-surface-2 border border-transparent'
                    )}
                  >
                    <div className="text-sm font-medium truncate">{q.name}</div>
                    {q.description && (
                      <div className="text-xs text-text-muted line-clamp-1 mt-0.5">{q.description}</div>
                    )}
                    {(q.lastRunAt || q.lastError) && (
                      <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-text-soft tabular">
                        {q.lastError ? (
                          <>
                            <AlertCircle className="size-3 text-negative-fg" />
                            <span className="text-negative-fg">errored</span>
                          </>
                        ) : (
                          <>
                            <Clock className="size-3" />
                            <span>{q.lastRunMs}ms · {fmtNum(q.lastRowCount ?? 0)} rows</span>
                          </>
                        )}
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
            {savedList.length === 0 && (
              <li className="text-sm text-text-muted text-center py-6">No saved queries yet.</li>
            )}
          </ul>
        </aside>

        {/* Editor + result */}
        <div>
          {current && (
            <div className="mb-4 px-1">
              <h2 className="font-display text-2xl">{current.name}</h2>
              {current.description && <p className="text-text-muted text-sm mt-0.5">{current.description}</p>}
            </div>
          )}

          <SqlRunner saved={current} />
        </div>
      </div>
    </main>
  );
}
