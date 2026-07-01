'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

export interface StackedBarSeries {
  key: string;
  label: string;
  color: string;
}

interface StackedBarProps {
  data: Array<Record<string, string | number>>;
  series: StackedBarSeries[];
  yKey?: string;
  height?: number;
  layout?: 'horizontal' | 'vertical';
}

export function StackedBar({ data, series, yKey = 'name', height = 260, layout = 'vertical' }: StackedBarProps) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer>
        <BarChart
          data={data}
          layout={layout === 'vertical' ? 'vertical' : 'horizontal'}
          margin={{ top: 5, right: 12, left: 8, bottom: 0 }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={layout === 'vertical'} horizontal={layout === 'horizontal'} />
          {layout === 'vertical' ? (
            <>
              <XAxis type="number" stroke="var(--text-soft)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis
                dataKey={yKey}
                type="category"
                stroke="var(--text-soft)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={100}
              />
            </>
          ) : (
            <>
              <XAxis dataKey={yKey} type="category" stroke="var(--text-soft)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis type="number" stroke="var(--text-soft)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
            </>
          )}
          <Tooltip
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
              padding: '6px 10px',
              boxShadow: 'var(--shadow-md)',
            }}
            cursor={{ fill: 'var(--surface-2)', opacity: 0.4 }}
          />
          <Legend
            verticalAlign="top"
            iconType="circle"
            iconSize={8}
            align="right"
            wrapperStyle={{ fontSize: 12 }}
          />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} radius={[4, 4, 4, 4]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
