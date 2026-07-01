import { listScraperOptions } from '@/lib/queries/reports';
import { ReportForm } from './report-form';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const scrapers = await listScraperOptions();

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 md:px-10 py-10 md:py-14">
      <header className="mb-10">
        <h1 className="font-display text-4xl md:text-5xl leading-tight tracking-tight">Reports</h1>
        <p className="mt-2 text-text-muted">
          Baixar snapshots de inventário por intervalo de datas · uma linha por slab por dia
        </p>
      </header>

      <ReportForm scrapers={scrapers} />
    </main>
  );
}
