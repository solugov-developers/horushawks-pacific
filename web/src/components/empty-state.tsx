import { cn } from '@/lib/utils';

interface EmptyStateProps {
  title: string;
  description?: string;
  hint?: string;
  className?: string;
}

export function EmptyState({ title, description, hint, className }: EmptyStateProps) {
  return (
    <div className={cn('rounded-2xl border border-border bg-surface px-10 py-20 text-center', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/horushawks-mark.png"
        alt=""
        width={48}
        height={48}
        className="mx-auto mb-5 opacity-30"
      />
      <h2 className="text-xl font-medium text-text-strong mb-2">{title}</h2>
      {description && <p className="text-text-muted max-w-md mx-auto">{description}</p>}
      {hint && <p className="text-text-soft text-sm mt-4 max-w-md mx-auto">{hint}</p>}
    </div>
  );
}
