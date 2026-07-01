import { cn } from '@/lib/utils';

interface HeatmapMatrixProps {
  rows: { location: string; category: string; slabs: number }[];
  locations: string[];
  categories: string[];
  title?: string;
}

/**
 * Heatmap location × categoria.
 * Intensidade da célula = slabs (log-scale-ish via raiz quadrada).
 * Cores via opacity em accent-700.
 */
export function HeatmapMatrix({ rows, locations, categories, title }: HeatmapMatrixProps) {
  const map = new Map<string, number>();
  rows.forEach((r) => map.set(`${r.location}|${r.category}`, r.slabs));
  const max = Math.max(1, ...rows.map((r) => r.slabs));

  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-5">
      {title && <h3 className="text-base font-medium text-text-strong mb-4">{title}</h3>}
      <div className="overflow-x-auto">
        <table className="text-xs w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="text-left text-text-soft font-medium uppercase tracking-wider px-2 py-2 sticky left-0 bg-surface z-10">
                Location
              </th>
              {categories.map((c) => (
                <th
                  key={c}
                  className="text-left text-text-soft font-medium uppercase tracking-wider px-1.5 py-2 whitespace-nowrap"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', minWidth: 24 }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {locations.map((loc) => (
              <tr key={loc}>
                <td className="px-2 py-1.5 text-text font-medium whitespace-nowrap sticky left-0 bg-surface z-10 border-r border-border">
                  {loc}
                </td>
                {categories.map((cat) => {
                  const v = map.get(`${loc}|${cat}`) ?? 0;
                  const intensity = v > 0 ? Math.sqrt(v / max) : 0;
                  return (
                    <td key={cat} className="p-0.5">
                      <div
                        className={cn(
                          'h-9 rounded flex items-center justify-center text-[10px] tabular',
                          v > 0 ? 'text-accent-on font-medium' : 'text-text-soft',
                        )}
                        style={{
                          background:
                            v > 0
                              ? `color-mix(in srgb, var(--accent-700) ${Math.round(intensity * 100)}%, var(--surface-2))`
                              : 'var(--surface-2)',
                          color: intensity > 0.45 ? 'var(--accent-on)' : 'var(--text-muted)',
                        }}
                        title={`${loc} · ${cat}: ${v.toLocaleString('en-US')} slabs`}
                      >
                        {v > 0 ? v.toLocaleString('en-US') : ''}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
