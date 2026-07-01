'use client';

import { useActionState, useState } from 'react';
import { Play, Save, Trash2, Download } from 'lucide-react';
import { runSqlAction, saveQueryAction, deleteQueryAction, type RunPayload } from './actions';
import { fmtNum, cn } from '@/lib/utils';
import { Button } from '@/components/button';
import type { SavedQuery } from '@/lib/queries/saved';

interface Props {
  saved: SavedQuery | null;
}

export function SqlRunner({ saved }: Props) {
  const initial = saved?.sql ?? '';
  const [sql, setSql] = useState(initial);
  const [state, formAction, pending] = useActionState<RunPayload | null, FormData>(runSqlAction, null);

  return (
    <div className="space-y-6">
      {/* Editor + Run + Save */}
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="savedId" value={saved?.id ?? ''} />
        <textarea
          name="sql"
          value={sql}
          onChange={e => setSql(e.target.value)}
          placeholder="SELECT * FROM scrapers ORDER BY id;"
          spellCheck={false}
          className="w-full font-mono text-sm rounded-2xl border border-border bg-surface px-4 py-3 min-h-[180px] resize-y focus:border-accent-500 focus:outline-none"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button type="submit" disabled={pending} size="sm">
            <Play className="size-3.5" />
            {pending ? 'Running…' : 'Run'}
          </Button>

          <span className="text-xs text-text-soft">
            ⌘/Ctrl + Enter • read-only • timeout 10s • max 1000 rows shown
          </span>
        </div>
      </form>

      {/* Save form (separate, so user pode salvar SEM rodar) */}
      <SaveForm saved={saved} sql={sql} />

      {/* Result */}
      {state && <ResultView payload={state} />}
    </div>
  );
}

function SaveForm({ saved, sql }: { saved: SavedQuery | null; sql: string }) {
  return (
    <details className="rounded-2xl border border-border bg-surface px-5 py-4">
      <summary className="cursor-pointer text-sm font-medium select-none">
        {saved ? `Edit "${saved.name}"` : 'Save current query…'}
      </summary>
      <form action={saveQueryAction} className="mt-4 space-y-3">
        <input type="hidden" name="savedId" value={saved?.id ?? ''} />
        <input type="hidden" name="sql" value={sql} />
        <input
          name="name"
          required
          defaultValue={saved?.name ?? ''}
          placeholder="Name (e.g. 'Inventory por categoria')"
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
        />
        <input
          name="description"
          defaultValue={saved?.description ?? ''}
          placeholder="Description (optional)"
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" variant="secondary" size="sm">
            <Save className="size-3.5" />
            {saved ? 'Update' : 'Save'}
          </Button>
          {saved && (
            <Button
              type="submit"
              formAction={deleteQueryAction}
              name="id"
              value={saved.id}
              variant="danger"
              size="sm"
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          )}
        </div>
      </form>
    </details>
  );
}

function ResultView({ payload }: { payload: RunPayload }) {
  const r = payload.result;
  if (!r.ok) {
    return (
      <div className="rounded-2xl border border-border bg-negative-bg px-5 py-4">
        <div className="text-xs uppercase tracking-wider text-negative-fg mb-1">Error · {r.durationMs}ms</div>
        <pre className="text-sm whitespace-pre-wrap font-mono text-negative-fg">{r.error}</pre>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-text-muted tabular flex items-center gap-3 flex-wrap">
        <span>{fmtNum(r.rowCount)} rows</span>
        <span>·</span>
        <span>{r.durationMs}ms</span>
        {r.rows.length < r.rowCount && (
          <>
            <span>·</span>
            <span className="text-warn-fg">showing first {r.rows.length}</span>
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={r.rows.length === 0}
            onClick={() => downloadCsv(r.columns, r.rows)}
          >
            <Download className="size-3.5" />
            CSV
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={r.rows.length === 0}
            onClick={() => downloadJson(r.columns, r.rows)}
          >
            <Download className="size-3.5" />
            JSON
          </Button>
        </span>
      </div>

      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto max-h-[600px]">
          <table className="text-sm w-max min-w-full">
            <thead className="bg-surface-2/50 sticky top-0">
              <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-text-soft">
                {r.columns.map(c => (
                  <th key={c} className="px-4 py-2 font-medium border-b border-border whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row, i) => (
                <tr key={i} className={cn('border-b border-border/60 last:border-0 hover:bg-surface-2/40')}>
                  {r.columns.map(c => (
                    <td key={c} className="px-4 py-1.5 align-top whitespace-nowrap font-mono text-xs">
                      {formatCell(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
              {r.rows.length === 0 && (
                <tr>
                  <td colSpan={r.columns.length || 1} className="px-4 py-8 text-center text-text-muted">
                    Empty result
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return '∅';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function cellToCsv(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadFile(content: string, mime: string, ext: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const a = document.createElement('a');
  a.href = url;
  a.download = `horushawks-sql-${ts}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadCsv(columns: string[], rows: Array<Record<string, unknown>>): void {
  const header = columns.map(cellToCsv).join(',');
  const body = rows.map((row) => columns.map((c) => cellToCsv(row[c])).join(',')).join('\r\n');
  // BOM pra Excel reconhecer UTF-8
  downloadFile('﻿' + header + '\r\n' + body, 'text/csv', 'csv');
}

function downloadJson(columns: string[], rows: Array<Record<string, unknown>>): void {
  const payload = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const c of columns) out[c] = row[c];
    return out;
  });
  downloadFile(JSON.stringify(payload, null, 2), 'application/json', 'json');
}
