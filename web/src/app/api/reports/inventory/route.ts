import { NextResponse, type NextRequest } from 'next/server';
import {
  queryInventoryReport,
  REPORT_COLUMNS,
} from '@/lib/queries/reports';
import { toCSV, toSQL } from '@/lib/reports-format';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';
  const format = (sp.get('format') || 'csv').toLowerCase();
  const scrapersStr = sp.get('scrapers') || '';

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: 'from/to devem ser YYYY-MM-DD' },
      { status: 400 },
    );
  }
  if (from > to) {
    return NextResponse.json({ error: 'from > to' }, { status: 400 });
  }
  if (format !== 'csv' && format !== 'sql') {
    return NextResponse.json(
      { error: "format deve ser 'csv' ou 'sql'" },
      { status: 400 },
    );
  }

  const scraperIds = scrapersStr
    ? scrapersStr
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
    : null;

  const toExclusive = addDay(to);
  const rows = await queryInventoryReport({
    from,
    toExclusive,
    scraperIds: scraperIds && scraperIds.length ? scraperIds : null,
  });

  const filename = `horushawks-inventory-${from}_${to}.${format}`;
  const body =
    format === 'csv'
      ? toCSV(REPORT_COLUMNS, rows)
      : toSQL(REPORT_COLUMNS, rows, {
          from,
          to,
          generatedAt: new Date().toISOString(),
        });

  return new Response(body, {
    headers: {
      'Content-Type':
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/sql; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Row-Count': String(rows.length),
    },
  });
}

function addDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}
