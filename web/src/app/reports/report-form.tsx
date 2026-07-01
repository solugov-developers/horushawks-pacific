'use client';

import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/button';
import { cn } from '@/lib/utils';
import type { ScraperOption } from '@/lib/queries/reports';

type Format = 'csv' | 'sql';

interface Props {
  scrapers: ScraperOption[];
}

export function ReportForm({ scrapers }: Props) {
  const today = todayYmd();
  const monthStart = firstOfMonth(today);

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [format, setFormat] = useState<Format>('csv');
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(scrapers.map((s) => s.id)),
  );

  const allSelected = selected.size === scrapers.length;
  const noneSelected = selected.size === 0;

  const downloadUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set('from', from);
    p.set('to', to);
    p.set('format', format);
    if (!allSelected && !noneSelected) {
      p.set('scrapers', [...selected].sort((a, b) => a - b).join(','));
    }
    return `/api/reports/inventory?${p.toString()}`;
  }, [from, to, format, selected, allSelected, noneSelected]);

  const invalidRange = !from || !to || from > to;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
      {/* Coluna principal */}
      <div className="space-y-6">
        {/* Range */}
        <Section title="Intervalo de datas">
          <div className="flex flex-wrap items-center gap-3">
            <DateField label="De" value={from} onChange={setFrom} max={to} />
            <span className="text-text-muted select-none">→</span>
            <DateField label="Até" value={to} onChange={setTo} min={from} max={today} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <PresetChip label="Este mês" onClick={() => { setFrom(monthStart); setTo(today); }} />
            <PresetChip label="Mês passado" onClick={() => {
              const p = previousMonthRange(today);
              setFrom(p.from);
              setTo(p.to);
            }} />
            <PresetChip label="Últimos 7 dias" onClick={() => {
              setFrom(daysBefore(today, 6));
              setTo(today);
            }} />
            <PresetChip label="Últimos 30 dias" onClick={() => {
              setFrom(daysBefore(today, 29));
              setTo(today);
            }} />
            <PresetChip label="Ano corrente" onClick={() => {
              setFrom(`${today.slice(0, 4)}-01-01`);
              setTo(today);
            }} />
          </div>
        </Section>

        {/* Formato */}
        <Section title="Formato">
          <div className="flex gap-2">
            <FormatOption
              active={format === 'csv'}
              onClick={() => setFormat('csv')}
              label="CSV"
              hint="Excel · Google Sheets · pandas"
            />
            <FormatOption
              active={format === 'sql'}
              onClick={() => setFormat('sql')}
              label="SQL"
              hint="INSERT statements · psql import"
            />
          </div>
        </Section>

        {/* Fontes */}
        <Section title="Fontes">
          <div className="mb-3 flex gap-2 text-xs">
            <button
              type="button"
              className="text-accent-500 hover:underline"
              onClick={() => setSelected(new Set(scrapers.map((s) => s.id)))}
            >
              Selecionar todas
            </button>
            <span className="text-text-soft">·</span>
            <button
              type="button"
              className="text-accent-500 hover:underline"
              onClick={() => setSelected(new Set())}
            >
              Limpar
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {scrapers.map((s) => {
              const checked = selected.has(s.id);
              return (
                <label
                  key={s.id}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm cursor-pointer transition-colors',
                    checked
                      ? 'border-accent-500 bg-accent-700/5 text-text-strong'
                      : 'border-border bg-surface hover:bg-surface-2',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-accent-700"
                    checked={checked}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(s.id);
                      else next.delete(s.id);
                      setSelected(next);
                    }}
                  />
                  {s.name}
                </label>
              );
            })}
          </div>
        </Section>
      </div>

      {/* Sidebar: resumo + download */}
      <aside className="md:sticky md:top-6 self-start rounded-2xl border border-border bg-surface p-5 space-y-4 h-fit">
        <div>
          <div className="text-xs uppercase tracking-[0.08em] text-text-soft">Download</div>
          <div className="mt-1 text-lg font-medium">
            {format.toUpperCase()} · {rangeLabel(from, to)}
          </div>
        </div>

        <div className="text-sm text-text-muted space-y-1">
          <div>
            <span className="text-text">{allSelected ? scrapers.length : selected.size}</span>
            <span> de {scrapers.length} fontes</span>
          </div>
          <div>
            <span className="text-text">{daysBetween(from, to)}</span>
            <span> dia(s) no intervalo</span>
          </div>
          <div className="text-xs text-text-soft pt-1">
            {format === 'csv'
              ? 'CSV UTF-8 com BOM · abre limpo no Excel'
              : 'SQL com CREATE TABLE + INSERT · pronto pra psql'}
          </div>
        </div>

        <a
          href={downloadUrl}
          className={cn(
            'block',
            (invalidRange || noneSelected) && 'pointer-events-none opacity-50',
          )}
          aria-disabled={invalidRange || noneSelected}
        >
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={invalidRange || noneSelected}
          >
            <Download className="size-4" />
            Baixar {format.toUpperCase()}
          </Button>
        </a>

        {invalidRange && (
          <p className="text-xs text-negative-fg">Intervalo inválido.</p>
        )}
        {noneSelected && (
          <p className="text-xs text-negative-fg">Selecione ao menos uma fonte.</p>
        )}
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 text-xs uppercase tracking-[0.08em] text-text-soft">{title}</div>
      {children}
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-soft">{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-accent-500 focus:outline-none tabular"
      />
    </label>
  );
}

function PresetChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-text hover:bg-surface-2 transition-colors"
    >
      {label}
    </button>
  );
}

function FormatOption({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded-xl border px-4 py-3 text-left transition-colors',
        active
          ? 'border-accent-500 bg-accent-700/5'
          : 'border-border bg-surface hover:bg-surface-2',
      )}
    >
      <div className="font-medium">{label}</div>
      <div className="text-xs text-text-soft">{hint}</div>
    </button>
  );
}

// ------- helpers -------

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function firstOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function daysBefore(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d - n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function previousMonthRange(ymd: string): { from: string; to: string } {
  const [y, m] = ymd.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const lastDay = new Date(py, pm, 0).getDate();
  return {
    from: `${py}-${pad2(pm)}-01`,
    to: `${py}-${pad2(pm)}-${pad2(lastDay)}`,
  };
}

function daysBetween(a: string, b: string): number {
  if (!a || !b || a > b) return 0;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.floor(ms / 86400000) + 1;
}

function rangeLabel(from: string, to: string): string {
  if (!from || !to) return '—';
  if (from === to) return from;
  return `${from} → ${to}`;
}
