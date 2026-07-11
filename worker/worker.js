const { Worker } = require('bullmq');
const { request } = require('undici');
const db = require('./lib/db');
const { connection } = require('./lib/queue');

const ENGINE_URL = process.env.ENGINE_URL || 'http://engine:4000';
const SAFE_IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

function quoteIdent(name) {
  if (typeof name !== 'string' || !SAFE_IDENT.test(name)) {
    throw new Error(`identificador inválido: ${name}`);
  }
  return `"${name}"`;
}

function getPath(obj, path) {
  if (obj == null || !path) return obj;
  const parts = String(path).split('.');
  let v = obj;
  for (const p of parts) {
    if (v == null) return undefined;
    v = v[p];
  }
  return v;
}

// Status flags chegam de fornecedores em formatos variados:
//   true / false / "true" / "false" / 1 / 0 / "1" / "0" / "Y" / "N" / "Yes" / "No"
//   ou strings de status como "OnHold", "InStock", "Reserved", "On SO", "In transit"
// Para colunas BOOLEAN (on_hold, on_so, in_transit), tentamos coercionar.
// Retorna true / false / null (desconhecido).
const TRUE_KEYWORDS  = new Set(['true','t','yes','y','1','on','onhold','hold','reserved','onso','intransit','transit']);
const FALSE_KEYWORDS = new Set(['false','f','no','n','0','off','instock','available']);

const BOOL_COLUMNS = new Set(['on_hold', 'on_so', 'in_transit']);

function coerceBool(v) {
  if (v === true || v === false) return v;
  if (v == null) return null;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const k = v.trim().toLowerCase();
    if (k === '' || k === 'null' || k === 'undefined') return null;
    if (TRUE_KEYWORDS.has(k))  return true;
    if (FALSE_KEYWORDS.has(k)) return false;
    // Heuristic: any string containing "hold" / "transit" / "reserve" → true
    if (/hold|transit|reserve|onso/i.test(k)) return true;
    if (/in.?stock|available|free/i.test(k))  return false;
    return null;
  }
  return null;
}

function collectSaveRows(actions, acc = []) {
  if (!Array.isArray(actions)) return acc;
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    if (a.type === 'save_rows') acc.push(a);
    if (a.type === 'loop') collectSaveRows(a.actions, acc);
  }
  return acc;
}

function pickRowValues(row, colMap, constants) {
  const out = {};
  const usedTops = new Set();
  for (const [dbCol, srcPath] of Object.entries(colMap)) {
    usedTops.add(String(srcPath).split('.')[0]);
    const v = getPath(row, srcPath);
    let resolved = v === undefined ? null : v;
    if (BOOL_COLUMNS.has(dbCol)) {
      resolved = coerceBool(resolved);
    }
    out[dbCol] = resolved;
  }
  // Constantes do save_rows: aplica DEPOIS do mapping, sobrescreve se conflito.
  // Útil pra fornecedores que não trazem o campo na resposta (ex: location, available_slabs default).
  if (constants && typeof constants === 'object') {
    for (const [dbCol, val] of Object.entries(constants)) {
      out[dbCol] = val;
    }
  }
  return { values: out, usedTops };
}

function buildSourceKey(vals, spec) {
  // Spec explícito (ex.: ["item_id","bundle"]) -> concatena os valores não-nulos
  // com '|'. Útil quando nenhum campo isolado é único (ex.: thestoneindustry, em
  // que IDOne colide mas item_id+IDOne é único).
  if (Array.isArray(spec) && spec.length) {
    const parts = spec
      .map((c) => vals[c])
      .filter((v) => v != null && v !== '')
      .map(String);
    return parts.length ? parts.join('|') : null;
  }
  // Padrão: prefere serial_number, depois bundle, depois item_id
  return (vals.serial_number != null && String(vals.serial_number)) ||
         (vals.bundle != null && String(vals.bundle)) ||
         (vals.item_id != null && String(vals.item_id)) ||
         null;
}

async function persistSaveRows(client, action, state, ctx) {
  const rows = getPath(state, action.from);
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`[worker] save_rows from="${action.from}": sem linhas`);
    return { inserted: 0, snapshots: 0 };
  }
  const table = quoteIdent(action.table);
  const colMap = action.columns || {};
  const dbCols = Object.keys(colMap);
  for (const c of dbCols) quoteIdent(c);

  const fixedCols = ['job_id', 'scraper_id'];
  const allCols = [...fixedCols, ...dbCols, 'extra'];
  const colList = allCols.map(quoteIdent).join(', ');

  // Snapshots: colunas conhecidas
  const snapCols = ['scraper_id','job_id','source_key','item_id','item_name','category_name','serial_number','bundle','color','location','thickness','available_qty','available_slabs','price','price_range','on_hold','on_so','in_transit','payload'];

  const BATCH = 500;
  let inserted = 0;
  let snapshots = 0;
  for (let off = 0; off < rows.length; off += BATCH) {
    const slice = rows.slice(off, off + BATCH);
    const params = [];
    const snapParams = [];
    const valuesSql = [];
    const snapValuesSql = [];

    for (const row of slice) {
      const { values: vals, usedTops } = pickRowValues(row, colMap, action.constants);

      // INSERT na tabela do fornecedor
      const placeholders = [];
      params.push(ctx.jobId);    placeholders.push(`$${params.length}`);
      params.push(ctx.scraperId); placeholders.push(`$${params.length}`);
      for (const dbCol of dbCols) {
        params.push(vals[dbCol] === undefined ? null : vals[dbCol]);
        placeholders.push(`$${params.length}`);
      }
      const extra = {};
      if (row && typeof row === 'object') {
        for (const k of Object.keys(row)) if (!usedTops.has(k)) extra[k] = row[k];
      }
      params.push(JSON.stringify(extra));
      placeholders.push(`$${params.length}::jsonb`);
      valuesSql.push(`(${placeholders.join(', ')})`);

      // INSERT em slabs_history
      const sourceKey = buildSourceKey(vals, action.source_key);
      if (sourceKey != null) {
        const sp = [];
        snapParams.push(ctx.scraperId); sp.push(`$${snapParams.length}`);
        snapParams.push(ctx.jobId);     sp.push(`$${snapParams.length}`);
        snapParams.push(sourceKey);     sp.push(`$${snapParams.length}`);
        for (const k of ['item_id','item_name','category_name','serial_number','bundle','color','location','thickness','available_qty','available_slabs','price','price_range','on_hold','on_so','in_transit']) {
          snapParams.push(vals[k] === undefined ? null : vals[k]);
          sp.push(`$${snapParams.length}`);
        }
        snapParams.push(JSON.stringify(extra)); sp.push(`$${snapParams.length}::jsonb`);
        snapValuesSql.push(`(${sp.join(', ')})`);
      }
    }

    if (valuesSql.length) {
      const sql = `INSERT INTO ${table} (${colList}) VALUES ${valuesSql.join(', ')}`;
      await client.query(sql, params);
      inserted += valuesSql.length;
    }
    if (snapValuesSql.length) {
      const sql = `INSERT INTO slabs_history (${snapCols.map(quoteIdent).join(', ')}) VALUES ${snapValuesSql.join(', ')}`;
      await client.query(sql, snapParams);
      snapshots += snapValuesSql.length;
    }
  }
  console.log(`[worker] save_rows -> ${action.table}: ${inserted} linhas + ${snapshots} snapshots`);
  return { inserted, snapshots };
}

async function computeMovements(client, ctx) {
  const { rows: prevRows } = await client.query(
    `SELECT id FROM jobs
     WHERE scraper_id = $1 AND status = 'done' AND id <> $2
     ORDER BY id DESC LIMIT 1`,
    [ctx.scraperId, ctx.jobId]
  );
  if (!prevRows.length) {
    console.log(`[worker] movements: sem job anterior, pulando`);
    return { added: 0, removed: 0, changed: 0, transferred: 0, held: 0, released: 0 };
  }
  const prevJobId = prevRows[0].id;

  const sql = `
    WITH cur AS (
      SELECT source_key, item_name, price, available_qty, location, on_hold
      FROM slabs_history WHERE scraper_id = $1 AND job_id = $2
    ), prev AS (
      SELECT source_key, item_name, price, available_qty, location, on_hold
      FROM slabs_history WHERE scraper_id = $1 AND job_id = $3
    ),
    added AS (
      SELECT c.source_key, c.item_name FROM cur c
      LEFT JOIN prev p ON p.source_key = c.source_key
      WHERE p.source_key IS NULL
    ),
    removed AS (
      SELECT p.source_key, p.item_name FROM prev p
      LEFT JOIN cur c ON c.source_key = p.source_key
      WHERE c.source_key IS NULL
    ),
    price_changed AS (
      SELECT c.source_key, c.item_name, p.price AS prev_price, c.price AS next_price
      FROM cur c JOIN prev p ON p.source_key = c.source_key
      WHERE c.price IS DISTINCT FROM p.price
    ),
    qty_changed AS (
      SELECT c.source_key, c.item_name, p.available_qty AS prev_q, c.available_qty AS next_q
      FROM cur c JOIN prev p ON p.source_key = c.source_key
      WHERE c.available_qty IS DISTINCT FROM p.available_qty
    ),
    location_changed AS (
      SELECT c.source_key, c.item_name, p.location AS prev_loc, c.location AS next_loc
      FROM cur c JOIN prev p ON p.source_key = c.source_key
      WHERE c.location IS DISTINCT FROM p.location
        AND p.location IS NOT NULL
        AND c.location IS NOT NULL
    ),
    held AS (
      SELECT c.source_key, c.item_name, p.on_hold AS prev_h, c.on_hold AS next_h
      FROM cur c JOIN prev p ON p.source_key = c.source_key
      WHERE c.on_hold IS DISTINCT FROM p.on_hold
        AND c.on_hold IS TRUE
    ),
    released AS (
      SELECT c.source_key, c.item_name, p.on_hold AS prev_h, c.on_hold AS next_h
      FROM cur c JOIN prev p ON p.source_key = c.source_key
      WHERE c.on_hold IS DISTINCT FROM p.on_hold
        AND (c.on_hold IS FALSE OR c.on_hold IS NULL)
        AND p.on_hold IS TRUE
    ),
    ins_a AS (
      INSERT INTO movements (scraper_id, job_id, prev_job_id, source_key, kind, item_name)
      SELECT $1, $2, $3, source_key, 'added', item_name FROM added RETURNING 1
    ),
    ins_r AS (
      INSERT INTO movements (scraper_id, job_id, prev_job_id, source_key, kind, item_name)
      SELECT $1, $2, $3, source_key, 'removed', item_name FROM removed RETURNING 1
    ),
    ins_p AS (
      INSERT INTO movements (scraper_id, job_id, prev_job_id, source_key, kind, item_name, prev_value, next_value)
      SELECT $1, $2, $3, source_key, 'price_changed', item_name, prev_price::text, next_price::text FROM price_changed RETURNING 1
    ),
    ins_q AS (
      INSERT INTO movements (scraper_id, job_id, prev_job_id, source_key, kind, item_name, prev_value, next_value)
      SELECT $1, $2, $3, source_key, 'qty_changed', item_name, prev_q::text, next_q::text FROM qty_changed RETURNING 1
    ),
    ins_t AS (
      INSERT INTO movements (scraper_id, job_id, prev_job_id, source_key, kind, item_name, prev_value, next_value)
      SELECT $1, $2, $3, source_key, 'transferred', item_name, prev_loc, next_loc FROM location_changed RETURNING 1
    ),
    ins_h AS (
      INSERT INTO movements (scraper_id, job_id, prev_job_id, source_key, kind, item_name, prev_value, next_value)
      SELECT $1, $2, $3, source_key, 'held', item_name, prev_h::text, next_h::text FROM held RETURNING 1
    ),
    ins_rel AS (
      INSERT INTO movements (scraper_id, job_id, prev_job_id, source_key, kind, item_name, prev_value, next_value)
      SELECT $1, $2, $3, source_key, 'released', item_name, prev_h::text, next_h::text FROM released RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM added)             AS added,
      (SELECT count(*) FROM removed)           AS removed,
      (SELECT count(*) FROM price_changed)
        + (SELECT count(*) FROM qty_changed)   AS changed,
      (SELECT count(*) FROM location_changed)  AS transferred,
      (SELECT count(*) FROM held)              AS held,
      (SELECT count(*) FROM released)          AS released`;
  const { rows } = await client.query(sql, [ctx.scraperId, ctx.jobId, prevJobId]);
  const r = rows[0];
  return {
    added:       parseInt(r.added, 10),
    removed:     parseInt(r.removed, 10),
    changed:     parseInt(r.changed, 10),
    transferred: parseInt(r.transferred, 10),
    held:        parseInt(r.held, 10),
    released:    parseInt(r.released, 10),
  };
}

async function fireWebhooks(scraperId, event, payload) {
  let hooks = [];
  try {
    const { rows } = await db.query(
      `SELECT * FROM webhooks WHERE enabled AND $2 = ANY(events) AND (scraper_id IS NULL OR scraper_id = $1)`,
      [scraperId, event]
    );
    hooks = rows;
  } catch (e) {
    console.warn('[webhook] query falhou:', e.message);
    return;
  }
  for (const h of hooks) {
    try {
      const body = JSON.stringify({ event, payload, sent_at: new Date().toISOString() });
      const headers = { 'content-type': 'application/json', 'user-agent': 'HorusHawks-Webhook/1.0' };
      if (h.secret) headers['x-horushawks-secret'] = h.secret;
      const r = await request(h.url, { method: 'POST', headers, body, bodyTimeout: 15_000, headersTimeout: 15_000 });
      const sc = r.statusCode;
      await db.query(
        `UPDATE webhooks SET last_delivered_at = now(), last_status = $2, last_error = NULL WHERE id = $1`,
        [h.id, sc]
      );
      console.log(`[webhook] ${event} -> ${h.url} = ${sc}`);
    } catch (err) {
      await db.query(
        `UPDATE webhooks SET last_delivered_at = now(), last_status = 0, last_error = $2 WHERE id = $1`,
        [h.id, err.message.slice(0, 500)]
      );
      console.warn(`[webhook] ${h.url} falhou: ${err.message}`);
    }
  }
}

async function processJob(job) {
  const { jobId, scraperId } = job.data;
  console.log(`[worker] processando job ${jobId} (scraper ${scraperId})`);

  await db.query(
    `UPDATE jobs SET status='running', started_at=now(), progress_done=0, progress_total=NULL, progress_label=NULL WHERE id=$1`,
    [jobId]
  );

  const scraperQ = await db.query('SELECT * FROM scrapers WHERE id = $1', [scraperId]);
  const scraper = scraperQ.rows[0];
  if (!scraper) {
    await db.query(
      `UPDATE jobs SET status='failed', finished_at=now(), error=$2 WHERE id=$1`,
      [jobId, 'Scraper não encontrado']
    );
    return;
  }

  try {
    const { statusCode, body } = await request(`${ENGINE_URL}/scrape`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: scraper.url,
        actions: scraper.actions,
        vars: scraper.vars || {},
        job_id: jobId,
      }),
      bodyTimeout: 1_800_000,
      headersTimeout: 1_800_000,
    });

    const json = await body.json();
    if (statusCode !== 200 || !json.success) {
      throw new Error(json.error || `engine retornou ${statusCode}`);
    }

    const state = json.data || {};
    const saveRowsActions = collectSaveRows(scraper.actions);

    const client = await db.connect();
    let totals = { inserted: 0, snapshots: 0 };
    let movements = { added: 0, removed: 0, changed: 0, transferred: 0, held: 0, released: 0 };
    try {
      await client.query('BEGIN');

      const summary = { ...state };
      for (const k of Object.keys(summary)) {
        if (Array.isArray(summary[k])) summary[k] = { __array_length: summary[k].length };
      }
      summary.__save_rows = [];

      for (const sa of saveRowsActions) {
        const r = await persistSaveRows(client, sa, state, { jobId, scraperId });
        totals.inserted += r.inserted;
        totals.snapshots += r.snapshots;
        summary.__save_rows.push({ table: sa.table, from: sa.from, rows: r.inserted, snapshots: r.snapshots });
      }

      // Diffs vs último job done
      if (totals.snapshots > 0) {
        movements = await computeMovements(client, { jobId, scraperId });
        summary.__movements = movements;
      }

      await client.query(
        `INSERT INTO results (job_id, scraper_id, payload) VALUES ($1, $2, $3)`,
        [jobId, scraperId, summary]
      );
      await client.query(
        `UPDATE jobs SET status='done', finished_at=now(),
            rows_inserted=$2,
            movements_added=$3, movements_removed=$4, movements_changed=$5,
            movements_transferred=$6, movements_held=$7, movements_released=$8
          WHERE id=$1`,
        [jobId, totals.inserted,
         movements.added, movements.removed, movements.changed,
         movements.transferred, movements.held, movements.released]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    console.log(`[worker] job ${jobId} concluído (rows=${totals.inserted}, mov=${movements.added}+${movements.removed}+${movements.changed})`);

    // Webhooks
    fireWebhooks(scraperId, 'job.done', {
      job_id: jobId, scraper_id: scraperId, scraper: scraper.name,
      rows: totals.inserted, movements,
    }).catch(() => {});
  } catch (err) {
    console.error(`[worker] job ${jobId} falhou:`, err.message);
    await db.query(
      `UPDATE jobs SET status='failed', finished_at=now(), error=$2 WHERE id=$1`,
      [jobId, err.message.slice(0, 2000)]
    );
    fireWebhooks(scraperId, 'job.failed', {
      job_id: jobId, scraper_id: scraperId, scraper: scraper.name, error: err.message,
    }).catch(() => {});
  }
}

/**
 * Reaper: marca como failed jobs que ficaram em 'running' por mais de 2h.
 * Roda no boot e a cada 30 min. Cobre worker crash, OOM, daemon Docker matar.
 */
async function reapOrphanJobs() {
  try {
    const { rowCount } = await db.query(`
      UPDATE jobs SET
        status = 'failed',
        finished_at = now(),
        error = coalesce(error, 'reaper: marked failed after running > 2h (worker crash?)')
      WHERE status IN ('running', 'queued')
        AND coalesce(started_at, created_at) < now() - interval '2 hours'
    `);
    if (rowCount > 0) console.log(`[worker] reaper: ${rowCount} jobs órfãos marcados como failed`);
  } catch (e) {
    console.warn('[worker] reaper falhou:', e.message);
  }
}
reapOrphanJobs();
setInterval(reapOrphanJobs, 30 * 60 * 1000);

const worker = new Worker('scrape', processJob, {
  connection,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2', 10),
  // Resiliência: tentativas + backoff exponencial
  defaultJobOptions: {
    attempts: parseInt(process.env.JOB_ATTEMPTS || '3', 10),
    backoff: {
      type: 'exponential',
      delay: 30_000, // 30s, depois 60s, depois 120s
    },
    // Limpeza de jobs antigos da fila (logs do BullMQ)
    removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
    removeOnFail:     { age: 30 * 24 * 3600, count: 5000 },
  },
});

worker.on('error', (err) => console.error('[worker] erro:', err));
worker.on('failed', (job, err) => {
  if (job) {
    console.error(`[worker] job ${job.id} (data.jobId=${job.data?.jobId}) falhou tentativa ${job.attemptsMade}/${job.opts.attempts}:`, err.message);
  }
});
worker.on('completed', (job) => {
  console.log(`[worker] BullMQ job ${job.id} (data.jobId=${job.data?.jobId}) completed`);
});

// Graceful shutdown — fecha worker antes do SIGTERM matar o container.
async function shutdown(signal) {
  console.log(`[worker] recebido ${signal}, fechando...`);
  try {
    await worker.close();
    await db.query('SELECT 1'); // flush
  } catch (e) {
    console.error('[worker] shutdown error:', e.message);
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('[worker] aguardando jobs...');
