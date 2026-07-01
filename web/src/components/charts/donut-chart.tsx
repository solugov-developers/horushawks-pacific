'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { CHART_COLORS } from './chart-theme';

export interface DonutSlice {
  name: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  data: DonutSlice[];
  /** Texto central — ex: "12,345 slabs" */
  centerLabel?: string;
  /** Texto secundário no centro */
  centerSubLabel?: string;
  height?: number;
  showLegend?: boolean;
}

export function DonutChart({
  data,
  centerLabel,
  centerSubLabel,
  height = 260,
  showLegend = true,
}: DonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="relative w-full" style={{ height }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="60%"
            outerRadius="90%"
            paddingAngle={2}
            stroke="var(--surface)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((slice, i) => (
              <Cell key={slice.name} fill={slice.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            cursor={{ fill: 'transparent' }}
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
              padding: '6px 10px',
              boxShadow: 'var(--shadow-md)',
            }}
            formatter={(value, name) => {
              const v = typeof value === 'number' ? value : Number(value) || 0;
              return [
                `${v.toLocaleString('en-US')} (${total > 0 ? ((v / total) * 100).toFixed(1) : '0'}%)`,
                String(name ?? ''),
              ];
            }}
          />
          {showLegend && (
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            />
          )}
        </PieChart>
      </ResponsiveContainer>

      {(centerLabel || centerSubLabel) && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
          {centerLabel && (
            <div className="text-2xl font-light tabular tracking-tight text-text-strong">
              {centerLabel}
            </div>
          )}
          {centerSubLabel && (
            <div className="text-[11px] uppercase tracking-[0.12em] text-text-soft mt-1">
              {centerSubLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
