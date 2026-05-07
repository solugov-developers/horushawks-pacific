const cron = require('node-cron');
const db = require('./lib/db');
const { scrapeQueue } = require('./lib/queue');

const tasks = new Map();

async function reload() {
  const { rows } = await db.query(
    `SELECT id, name, schedule FROM scrapers WHERE enabled = true AND schedule IS NOT NULL`
  );

  const wantedIds = new Set(rows.map((r) => r.id));

  for (const [id, entry] of tasks.entries()) {
    const stillWanted = rows.find((r) => r.id === id && r.schedule === entry.schedule);
    if (!stillWanted) {
      entry.task.stop();
      tasks.delete(id);
      console.log(`[scheduler] removido scraper ${id} (${entry.name})`);
    }
  }

  for (const r of rows) {
    if (tasks.has(r.id)) continue;
    if (!cron.validate(r.schedule)) {
      console.warn(`[scheduler] cron inválido em ${r.name}: ${r.schedule}`);
      continue;
    }
    const task = cron.schedule(r.schedule, async () => {
      try {
        const ins = await db.query(
          `INSERT INTO jobs (scraper_id, status, triggered_by) VALUES ($1, 'queued', 'scheduled') RETURNING id`,
          [r.id]
        );
        const jobId = ins.rows[0].id;
        await scrapeQueue.add('run', { jobId, scraperId: r.id });
        console.log(`[scheduler] disparou ${r.name} (job ${jobId})`);
      } catch (err) {
        console.error(`[scheduler] erro ao disparar ${r.name}:`, err.message);
      }
    });
    tasks.set(r.id, { task, schedule: r.schedule, name: r.name });
    console.log(`[scheduler] agendou ${r.name} com ${r.schedule}`);
  }
}

reload().catch((e) => console.error('[scheduler] reload inicial falhou:', e));
setInterval(() => reload().catch((e) => console.error('[scheduler] reload falhou:', e)), 30_000);

console.log('[scheduler] iniciado, recarregando agenda a cada 30s');
