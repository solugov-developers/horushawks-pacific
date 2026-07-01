'use client';

import {
  LineChart as RC_LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { CHART_COLORS } from './chart-theme';

export interface LineSeries {
  key: string;
  label: string;
  color?: string;
}

export type XTickFormat = 'date-short' | 'date-day' | 'raw';

interface LineChartProps {
  /** Array de pontos. Cada objeto deve ter um campo `date` (string) + um valor por série. */
  data: Array<Record<string, string | number>>;
  series: LineSeries[];
  height?: number;
  xKey?: string;
  /** Formato pré-definido para tick do eixo X (Server→Client safe). */
  xTickFormat?: XTickFormat;
  /** Formato pré-definido para tooltip values. */
  valueFormat?: 'number' | 'raw';
  showLegend?: boolean;
}

function formatTick(value: string, fmt: XTickFormat): string {
  if (fmt === 'raw') return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  if (fmt === 'date-day') return String(d.getUTCDate());
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function LineChart({
  data,
  series,
  height = 260,
  xKey = 'date',
  xTickFormat = 'date-short',
  valueFormat = 'number',
  showLegend = true,
}: LineChartProps) {
  const valueFormatter = (v: number) =>
    valueFormat === 'number' ? v.toLocaleString('en-US') : String(v);
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer>
        <RC_LineChart data={data} margin={{ top: 5, right: 12, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={xKey}
            stroke="var(--text-soft)"
            fontSize={11}
            tickFormatter={(v) => formatTick(String(v), xTickFormat)}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            stroke="var(--text-soft)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
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
              return [valueFormatter(v), String(name ?? '')];
            }}
            labelStyle={{ color: 'var(--text-strong)', fontWeight: 500, fontSize: 11 }}
          />
          {showLegend && (
            <Legend
              verticalAlign="top"
              iconType="circle"
              iconSize={8}
              align="right"
              wrapperStyle={{ fontSize: 12 }}
            />
          )}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </RC_LineChart>
      </ResponsiveContainer>
    </div>
  );
}
