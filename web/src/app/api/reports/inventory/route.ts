import { NextResponse, type NextRequest } from 'next/server';
import {
  streamInventoryRows,
  REPORT_COLUMNS,
} from '@/lib/queries/reports';
import {
  csvHeaderBytes,
  csvRowsBytes,
  sqlHeaderBytes,
  sqlInsertBytes,
  sqlFooterBytes,
} from '@/lib/reports-format';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Converte um async iterator (bytes) num ReadableStream. Ver doc do Next 16:
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md#streaming
function iteratorToStream(iterator: AsyncIterator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      // Download abortado: encerra o gerador -> roda o finally (ROLLBACK+release).
      await iterator.return?.();
    },
  });
}

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
  const opts = {
    from,
    toExclusive,
    scraperIds: scraperIds && scraperIds.length ? scraperIds : null,
  };

  // Gera os bytes por pedaço a partir do cursor — memória constante mesmo em
  // exports de centenas de milhares de linhas (antes montava tudo em memória e
  // estourava os 250MB do container).
  async function* csvBytes(): AsyncGenerator<Uint8Array> {
    yield csvHeaderBytes(REPORT_COLUMNS);
    for await (const batch of streamInventoryRows(opts)) {
      yield csvRowsBytes(REPORT_COLUMNS, batch);
    }
  }
  async function* sqlBytes(): AsyncGenerator<Uint8Array> {
    yield sqlHeaderBytes({ from, to, generatedAt: new Date().toISOString() });
    for await (const batch of streamInventoryRows(opts)) {
      yield sqlInsertBytes(REPORT_COLUMNS, batch);
    }
    yield sqlFooterBytes();
  }

  const filename = `horushawks-inventory-${from}_${to}.${format}`;
  const stream = iteratorToStream((format === 'csv' ? csvBytes() : sqlBytes())[Symbol.asyncIterator]());

  return new Response(stream, {
    headers: {
      'Content-Type':
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/sql; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

function addDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}
