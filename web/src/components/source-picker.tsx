import Link from 'next/link';
import { SOURCES, ALL_SOURCES } from '@/lib/sources';
import { cn } from '@/lib/utils';

interface SourcePickerProps {
  /** rota base sem query, ex: "/inventory" */
  basePath: string;
  /** valor atual ('all' ou slug do scraper) */
  current: string;
  /** queryParams a preservar (ex: filtros) */
  preserve?: Record<string, string | undefined>;
}

export function SourcePicker({ basePath, current, preserve }: SourcePickerProps) {
  function build(slug: string) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(preserve ?? {})) {
      if (v != null && v !== '' && k !== 'source') params.set(k, v);
    }
    if (slug !== ALL_SOURCES) params.set('source', slug);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const items = [{ slug: ALL_SOURCES, label: 'All sources' }, ...SOURCES.map(s => ({ slug: s.slug, label: s.label }))];

  return (
    <ul className="flex flex-wrap items-center gap-2 mb-6">
      {items.map(it => {
        const active = (current === ALL_SOURCES && it.slug === ALL_SOURCES) || current === it.slug;
        return (
          <li key={it.slug}>
            <Link
              href={build(it.slug)}
              className={cn(
                'inline-block rounded-full px-3 py-1.5 text-sm border transition-colors',
                active
                  ? 'bg-surface-2 text-accent-700 border-border-strong font-medium dark:text-text-strong'
                  : 'bg-surface text-text-muted border-border hover:bg-surface-2 hover:text-text'
              )}
            >
              {it.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
