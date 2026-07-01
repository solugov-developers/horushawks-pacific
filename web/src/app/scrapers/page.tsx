import { Play, Power, Clock } from 'lucide-react';
import { getScrapersOverview, getScrapersHealth } from '@/lib/queries/scrapers';
import { fmtNum, cn } from '@/lib/utils';
import { StackedBar } from '@/components/charts/stacked-bar';
import { runNowAction, toggleScraperAction, updateScheduleAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ScrapersPage() {
  const [rows, health] = await Promise.all([getScrapersOverview(), getScrapersHealth(7)]);

  const healthData = health.map((h) => ({
    name: h.name,
    done: h.doneLastN,
    failed: h.failedLastN,
  }));

  const totalDone = health.reduce((s, h) => s + h.doneLastN, 0);
  const totalFailed = health.reduce((s, h) => s + h.failedLastN, 0);
  const successRate = totalDone + totalFailed > 0 ? totalDone / (totalDone + totalFailed) : 0;

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 md:px-10 py-10 md:py-14">
      <header className="mb-8">
        <h1 className="font-display text-4xl md:text-5xl leading-tight text-text-strong">Scrapers</h1>
        <p className="mt-2 text-text-muted">
          Gerenciar robôs · ligar/desligar · agendar · disparar agora
        </p>
      </header>

      {/* Health overview */}
      <section className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-5 md:gap-6 mb-8">
        <div className="rounded-2xl border border-border bg-surface px-5 py-5">
          <div className="mb-3">
            <h3 className="text-base font-medium text-text-strong">Jobs · last 7 days</h3>
            <p className="text-xs text-text-muted mt-0.5">By scraper, by status</p>
          </div>
          {healthData.length === 0 ? (
            <p className="text-text-soft text-sm py-8 text-center">No job activity in the last 7 days.</p>
          ) : (
            <StackedBar
              data={healthData}
              series={[
                { key: 'done', label: 'Completed', color: '#2F6E3C' },
                { key: 'failed', label: 'Failed', color: '#8C3D2E' },
              ]}
              height={Math.max(200, healthData.length * 36 + 60)}
              layout="vertical"
            />
          )}
        </div>

        <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col justify-center">
          <div className="text-[11px] uppercase tracking-[0.12em] text-text-soft mb-2">Success rate · 7d</div>
          <div className="text-5xl font-light tabular tracking-tight text-text-strong">
            {(successRate * 100).toFixed(0)}<span className="text-2xl text-text-muted">%</span>
          </div>
          <div className="mt-4 text-sm text-text-muted">
            {totalDone} completed · {totalFailed} failed
          </div>
          <div className="mt-2 text-xs text-text-soft">
            avg duration · {avgDurationLabel(health)}
          </div>
        </div>
      </section>

      <CronHelp />

      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        {rows.map((s, i) => (
          <ScraperCard key={s.id} scraper={s} isLast={i === rows.length - 1} />
        ))}
      </div>
    </main>
  );
}

function avgDurationLabel(health: { avgDurationSec: number | null }[]): string {
  const valid = health.filter((h) => h.avgDurationSec != null && h.avgDurationSec > 0);
  if (valid.length === 0) return '—';
  const avg = valid.reduce((s, h) => s + (h.avgDurationSec ?? 0), 0) / valid.length;
  if (avg < 60) return `${avg.toFixed(0)}s`;
  return `${Math.round(avg / 60)}m`;
}

function ScraperCard({ scraper: s, isLast }: { scraper: Awaited<ReturnType<typeof getScrapersOverview>>[0]; isLast: boolean }) {
  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-[1fr_240px_240px_180px] gap-4 px-5 py-5', !isLast && 'border-b border-border')}>
      {/* Identidade + status */}
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span className={cn('size-2 rounded-full shrink-0', s.enabled ? 'bg-positive-fg' : 'bg-text-soft')}
            title={s.enabled ? 'enabled' : 'disabled'} />
          <h3 className="text-base font-medium text-text-strong truncate">{s.name}</h3>
          {s.lastJobStatus && (
            <span className={cn(
              'text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5',
              s.lastJobStatus === 'done'    && 'bg-positive-bg text-positive-fg',
              s.lastJobStatus === 'failed'  && 'bg-negative-bg text-negative-fg',
              s.lastJobStatus === 'running' && 'bg-info-bg text-info-fg',
              s.lastJobStatus === 'queued'  && 'bg-warn-bg text-warn-fg',
            )}>
              {s.lastJobStatus}
            </span>
          )}
        </div>
        {s.description && <p className="text-xs text-text-muted mt-1 line-clamp-1">{s.description}</p>}
        <div className="flex items-center gap-3 mt-2 text-xs text-text-soft tabular">
          <span>{fmtNum(s.totalSlabsLatest)} slabs</span>
          <span>·</span>
          <span>{s.totalDoneJobs} done jobs</span>
          {s.lastJobAt && (
            <>
              <span>·</span>
              <span>last {formatRelative(s.lastJobAt)}</span>
            </>
          )}
        </div>
      </div>

      {/* Schedule edit */}
      <form action={updateScheduleAction} className="flex items-center gap-2">
        <input type="hidden" name="id" value={s.id} />
        <Clock className="size-4 text-text-soft shrink-0" />
        <input
          name="schedule"
          defaultValue={s.schedule ?? ''}
          placeholder="0 1 * * *"
          className="font-mono text-xs w-full rounded-md border border-border bg-bg px-2 py-1 hover:border-border-strong focus:border-accent-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md bg-surface-2 hover:bg-gray-200 dark:hover:bg-gray-700 text-xs px-2 py-1 border border-border"
          title="Salvar cron"
        >
          Save
        </button>
      </form>

      {/* Toggle enabled */}
      <form action={toggleScraperAction} className="flex items-center justify-end gap-2">
        <input type="hidden" name="id" value={s.id} />
        <button
          type="submit"
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm border',
            s.enabled
              ? 'bg-positive-bg text-positive-fg border-positive-bg'
              : 'bg-surface-2 text-text-muted border-border'
          )}
        >
          <Power className="size-3.5" />
          {s.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </form>

      {/* Run now */}
      <form action={runNowAction} className="flex items-center justify-end">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-xl bg-accent-700 hover:bg-accent-600 active:bg-accent-800 text-accent-on px-4 py-1.5 text-sm font-medium"
        >
          <Play className="size-3.5" />
          Run now
        </button>
      </form>
    </div>
  );
}

function CronHelp() {
  return (
    <details className="mb-6 rounded-2xl border border-border bg-surface px-5 py-4">
      <summary className="cursor-pointer text-sm font-medium select-none">Cron syntax (5 fields)</summary>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-text-muted">
        <div>
          <code className="font-mono text-xs bg-surface-2 rounded px-1.5 py-0.5">m h dom mon dow</code>
          <p className="mt-1">minute · hour · day-of-month · month · day-of-week</p>
        </div>
        <ul className="space-y-1 font-mono text-xs">
          <li><code>0 1 * * *</code> — todos os dias 01:00 UTC = 22:00 BRT</li>
          <li><code>0 */6 * * *</code> — a cada 6 horas</li>
          <li><code>0 9 * * 1</code> — toda segunda 09:00 UTC</li>
          <li><code>(empty)</code> — desativa o agendamento</li>
        </ul>
      </div>
    </details>
  );
}

function formatRelative(date: Date): string {
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
