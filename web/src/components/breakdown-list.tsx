import { cn, fmtNum } from '@/lib/utils';

interface Row {
  label: string;
  value: number;
}

interface BreakdownListProps {
  title: string;
  rows: Row[];
  total?: number;
  className?: string;
}

export function BreakdownList({ title, rows, total, className }: BreakdownListProps) {
  const max = total ?? Math.max(...rows.map(r => r.value), 1);
  return (
    <div className={cn(
      'rounded-2xl bg-surface border border-border px-6 py-6 shadow-[var(--shadow-xs)]',
      className
    )}>
      <h3 className="text-base font-medium text-text-strong mb-5">{title}</h3>
      <ul className="space-y-3">
        {rows.map(r => {
          const pct = (r.value / max) * 100;
          return (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-text truncate">{r.label || '(empty)'}</span>
                <span className="text-sm tabular text-text-muted">{fmtNum(r.value)}</span>
              </div>
              <div className="mt-1.5 h-[3px] rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full bg-accent-700 dark:bg-accent-400 transition-[width]"
                  style={{ width: `${pct.toFixed(2)}%`, opacity: 0.85 }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
