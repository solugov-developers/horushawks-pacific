import { Plus, Minus, ArrowRightLeft, Pause, Play, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const map = {
  added:        { icon: Plus,           tone: 'positive' },
  removed:      { icon: Minus,          tone: 'negative' },
  transferred:  { icon: ArrowRightLeft, tone: 'info' },
  held:         { icon: Pause,          tone: 'warn' },
  released:     { icon: Play,           tone: 'positive' },
  price_changed:{ icon: TrendingUp,     tone: 'warn' },
  qty_changed:  { icon: TrendingDown,   tone: 'info' },
} as const;

type Kind = keyof typeof map;

const toneClasses = {
  positive: 'bg-positive-bg text-positive-fg',
  negative: 'bg-negative-bg text-negative-fg',
  info:     'bg-info-bg text-info-fg',
  warn:     'bg-warn-bg text-warn-fg',
} as const;

export function MovementIcon({ kind, size = 'md' }: { kind: string; size?: 'sm' | 'md' | 'lg' }) {
  const m = map[kind as Kind];
  if (!m) {
    return (
      <div className="size-9 rounded-full bg-surface-2 flex items-center justify-center text-text-soft">
        ?
      </div>
    );
  }
  const Icon = m.icon;
  const dim = size === 'sm' ? 'size-7' : size === 'lg' ? 'size-11' : 'size-9';
  const iconSize = size === 'sm' ? 'size-3.5' : size === 'lg' ? 'size-5' : 'size-4';
  return (
    <div className={cn('rounded-full flex items-center justify-center shrink-0', dim, toneClasses[m.tone])}>
      <Icon className={iconSize} />
    </div>
  );
}

export const MOVEMENT_KINDS: Kind[] = ['added','removed','transferred','held','released','price_changed','qty_changed'];
