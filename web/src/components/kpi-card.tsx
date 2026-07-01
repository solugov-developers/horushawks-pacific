import { cn } from '@/lib/utils';

interface KPICardProps {
  overline: string;
  value: string;
  delta?: string;
  deltaTone?: 'positive' | 'negative' | 'neutral';
  /** @deprecated mantido para compatibilidade; ignorado no novo design */
  blob?: 'emerald' | 'sky' | 'violet' | 'stone' | 'none';
  size?: 'xl' | 'lg' | 'md';
  caption?: string;
}

const sizeClasses: Record<NonNullable<KPICardProps['size']>, string> = {
  xl: 'text-6xl md:text-7xl',
  lg: 'text-5xl md:text-6xl',
  md: 'text-4xl md:text-5xl',
};

const toneClasses = {
  positive: 'bg-positive-bg text-positive-fg',
  negative: 'bg-negative-bg text-negative-fg',
  neutral:  'bg-surface-2 text-text-muted',
} as const;

export function KPICard({ overline, value, delta, deltaTone = 'neutral', size = 'lg', caption }: KPICardProps) {
  return (
    <div className="relative rounded-2xl bg-surface px-7 py-8 border border-border shadow-[var(--shadow-sm)]">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text-soft font-medium">
        {overline}
      </div>

      <div className={cn('mt-3 font-sans font-light tabular tracking-tight text-text-strong leading-none', sizeClasses[size])}>
        {value}
      </div>

      {(delta || caption) && (
        <div className="mt-5 flex items-center gap-2">
          {delta && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-xs tabular',
                toneClasses[deltaTone]
              )}
            >
              {delta}
            </span>
          )}
          {caption && <span className="text-xs text-text-muted">{caption}</span>}
        </div>
      )}
    </div>
  );
}
