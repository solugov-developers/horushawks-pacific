import type { ReportRow } from './queries/reports';

function cellCsv(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(columns: readonly string[], rows: ReportRow[]): string {
  const header = columns.join(',');
  const body = rows
    .map((row) => columns.map((c) => cellCsv((row as Record<string, unknown>)[c])).join(','))
    .join('\r\n');
  // BOM pra Excel abrir UTF-8 sem trocar acento
  return '﻿' + header + '\r\n' + body + (rows.length ? '\r\n' : '');
}

function cellSql(v: unknown): string {
  if (v == null) return 'NULL';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    return Number.isFinite(v) ? String(v) : 'NULL';
  }
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `'${s.replace(/'/g, "''")}'`;
}

const SQL_HEADER_DDL = `CREATE TABLE IF NOT EXISTS slabs_history_export (
  scraper_name    TEXT,
  scraped_at      TIMESTAMPTZ,
  source_key      TEXT,
  item_id         BIGINT,
  item_name       TEXT,
  category_name   TEXT,
  serial_number   TEXT,
  bundle          TEXT,
  color           TEXT,
  location        TEXT,
  thickness       TEXT,
  available_qty   NUMERIC,
  available_slabs INTEGER,
  price           NUMERIC,
  price_range     TEXT,
  on_hold         BOOLEAN,
  on_so           BOOLEAN,
  in_transit      BOOLEAN
);`;

interface SqlMeta {
  from: string;
  to: string;
  generatedAt: string;
}

export function toSQL(columns: readonly string[], rows: ReportRow[], meta: SqlMeta): string {
  const head = [
    `-- HorusHawks · slabs_history dump`,
    `-- Range: ${meta.from} to ${meta.to} (inclusive)`,
    `-- Rows:  ${rows.length}`,
    `-- Generated: ${meta.generatedAt}`,
    ``,
    SQL_HEADER_DDL,
    ``,
    `BEGIN;`,
  ].join('\n');

  if (rows.length === 0) return head + '\nCOMMIT;\n';

  const colList = columns.join(', ');
  // Chunk INSERTs em blocos de 500 rows pra facilitar parsing em client SQL
  const CHUNK = 500;
  const parts: string[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = slice
      .map((row) =>
        `  (${columns.map((c) => cellSql((row as Record<string, unknown>)[c])).join(', ')})`,
      )
      .join(',\n');
    parts.push(`INSERT INTO slabs_history_export (${colList}) VALUES\n${values};`);
  }

  return `${head}\n${parts.join('\n\n')}\nCOMMIT;\n`;
}
