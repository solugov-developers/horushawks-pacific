const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const cronParser = require('cron-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { doubleCsrf } = require('csrf-csrf');
const db = require('./lib/db');
const { scrapeQueue } = require('./lib/queue');
const { veining } = require('./lib/veining');
const { verifyCredentials, bootstrapAdmin } = require('./lib/auth');

const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET === 'change-me' || SESSION_SECRET === 'dev-secret-trocar-em-producao-trocar') {
  if (IS_PROD) {
    console.error('[panel] SESSION_SECRET inválido em produção. Aborting.');
    process.exit(1);
  } else {
    console.warn('[panel] SESSION_SECRET inseguro — só serve em dev.');
  }
}

const app = express();
app.set('trust proxy', 1); // necessário atrás de Caddy/ALB

// Helmet: headers de segurança (CSP, X-Frame, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // Tailwind via CDN + HTMX inline events. Permitir 'unsafe-inline' no CSS
      // até trocarmos pra Tailwind buildado. Scripts vêm de CDNs conhecidos.
      'script-src':  ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://unpkg.com', 'https://cdn.jsdelivr.net'],
      'style-src':   ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://fonts.googleapis.com'],
      'font-src':    ["'self'", 'data:', 'https://fonts.gstatic.com'],
      'img-src':     ["'self'", 'data:', 'blob:', 'https:'],
      'connect-src': ["'self'"],
    },
  },
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser(SESSION_SECRET || 'dev-cookie-secret'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  name: 'horushawks.sid',
  secret: SESSION_SECRET || 'dev-only-do-not-use-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD, // só HTTPS em prod
  },
}));

// Rate limits ----------------------------------------------------------------
// /login: 10 tentativas / 15min por IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});
// /api/v1: 60 req/min por IP (tokens podem subir esse limite — TODO)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// CSRF -----------------------------------------------------------------------
// double-submit cookie. Pula /api/v1/* (Bearer token é auth+integrity).
const { doubleCsrfProtection, generateToken } = doubleCsrf({
  getSecret: () => SESSION_SECRET || 'dev-csrf-secret-only',
  cookieName: IS_PROD ? '__Host-horushawks.x-csrf' : 'horushawks.x-csrf',
  cookieOptions: { sameSite: 'lax', httpOnly: true, secure: IS_PROD, path: '/' },
  size: 32,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req) => req.body?._csrf || req.headers['x-csrf-token'],
});

function csrfMiddleware(req, res, next) {
  // API tem auth Bearer e não usa cookie de sessão, pula CSRF.
  if (req.path.startsWith('/api/')) return next();
  return doubleCsrfProtection(req, res, next);
}
app.use(csrfMiddleware);

// Expõe csrfToken (já gerado) pra views. EJS includes não herdam locals
// por default, então geramos uma vez por request e o include recebe via parâmetro.
app.use((req, res, next) => {
  let cachedToken = null;
  res.locals.getCsrfToken = () => {
    if (cachedToken == null) {
      try {
        cachedToken = generateToken(req, res);
      } catch (e) {
        console.warn('[panel] generateToken falhou:', e.message);
        cachedToken = '';
      }
    }
    return cachedToken;
  };
  next();
});

function requireAuth(req, res, next) {
  if (req.session.authed) return next();
  // CRÍTICO: NÃO dar bypass cego em /api. Cada handler de /api/v1 chama
  // requireApiToken (Bearer). Aqui só redirecionamos UI.
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.redirect('/login');
}

const SLAB_TABLES = ['encore_slabs','crs_slabs','nsr_slabs','granitedistributor_slabs','vmcstone_slabs','zucchistones_slabs'];

async function audit(actor, action, target, metadata = {}, ip = null) {
  try {
    await db.query(
      `INSERT INTO audit_log (actor, action, target, metadata, ip) VALUES ($1, $2, $3, $4, $5)`,
      [actor, action, target, JSON.stringify(metadata), ip]
    );
  } catch (_) {}
}

// ================== AUTH ==================
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  try {
    const user = await verifyCredentials(username, password);
    if (user) {
      req.session.regenerate((err) => {
        if (err) {
          console.error('[panel] session regenerate falhou:', err);
          return res.status(500).render('login', { error: 'Erro interno' });
        }
        req.session.authed = true;
        req.session.userId = user.id;
        req.session.user = user.username;
        req.session.role = user.role;
        audit(user.username, 'login', null, { role: user.role }, req.ip);
        res.redirect('/');
      });
      return;
    }
  } catch (e) {
    console.error('[panel] verifyCredentials erro:', e.message);
  }
  audit(username || '?', 'login.failed', null, {}, req.ip);
  res.status(401).render('login', { error: 'Usuário ou senha inválidos' });
});

app.post('/logout', (req, res) => {
  audit(req.session.user || '?', 'logout', null, {}, req.ip);
  req.session.destroy(() => res.redirect('/login'));
});

// Aplica rate limit a /api/v1 (deve vir antes das rotas)
app.use('/api/v1', apiLimiter);

// ================== DASHBOARD (OPR) ==================
app.get('/', requireAuth, async (req, res) => {
  // KPIs
  const scrapersCount = await db.query(`SELECT
    count(*) FILTER (WHERE enabled) AS active,
    count(*) AS total,
    count(*) FILTER (WHERE schedule IS NOT NULL AND enabled) AS scheduled
  FROM scrapers`);

  const jobs24h = await db.query(`SELECT
    count(*) AS n,
    count(*) FILTER (WHERE status='done') AS done,
    count(*) FILTER (WHERE status='failed') AS failed
  FROM jobs WHERE created_at > now() - interval '24 hours'`);

  const jobs7d = await db.query(`SELECT
    count(*) FILTER (WHERE status='done') AS done,
    count(*) FILTER (WHERE status='failed') AS failed
  FROM jobs WHERE created_at > now() - interval '7 days'`);

  const runningCount = await db.query(`SELECT count(*) AS n FROM jobs WHERE status IN ('running','queued')`);

  // Total slabs em todas as tabelas
  let totalSlabs = 0;
  const perSourceCounts = {};
  for (const t of SLAB_TABLES) {
    try {
      const r = await db.query(`SELECT count(*) AS n FROM ${t}`);
      const n = parseInt(r.rows[0].n, 10);
      perSourceCounts[t.replace('_slabs','')] = n;
      totalSlabs += n;
    } catch (_) { perSourceCounts[t.replace('_slabs','')] = 0; }
  }

  // Delta vs ontem (mais conservador: compara último job de cada scraper hoje vs ontem)
  const movToday = await db.query(`
    SELECT
      coalesce(sum(movements_added), 0) AS added,
      coalesce(sum(movements_removed), 0) AS removed,
      coalesce(sum(movements_changed), 0) AS changed
    FROM jobs WHERE status='done' AND finished_at > now() - interval '24 hours'`);

  const done7  = parseInt(jobs7d.rows[0].done, 10);
  const failed7= parseInt(jobs7d.rows[0].failed, 10);
  const successRate = (done7 + failed7) > 0 ? Math.round((done7 / (done7 + failed7)) * 100) : 100;

  const kpis = {
    activeScrapers: parseInt(scrapersCount.rows[0].active, 10),
    totalScrapers:  parseInt(scrapersCount.rows[0].total, 10),
    scheduledScrapers: parseInt(scrapersCount.rows[0].scheduled, 10),
    jobs24h: parseInt(jobs24h.rows[0].n, 10),
    jobs24hDone: parseInt(jobs24h.rows[0].done, 10),
    jobs24hFailed: parseInt(jobs24h.rows[0].failed, 10),
    jobsRunning: parseInt(runningCount.rows[0].n, 10),
    jobsDone7d: done7, jobsFailed7d: failed7, successRate,
    totalSlabs,
    perSource: perSourceCounts,
    movements: {
      added:   parseInt(movToday.rows[0].added, 10),
      removed: parseInt(movToday.rows[0].removed, 10),
      changed: parseInt(movToday.rows[0].changed, 10),
    },
  };

  // Pulso de cada robô — sparkline 7d (jobs done count) + último status
  const pulseQ = await db.query(`
    SELECT s.id, s.name, s.description, s.schedule, s.enabled,
      (SELECT j.status FROM jobs j WHERE j.scraper_id = s.id ORDER BY j.id DESC LIMIT 1) AS last_status,
      (SELECT j.finished_at FROM jobs j WHERE j.scraper_id = s.id ORDER BY j.id DESC LIMIT 1) AS last_run,
      (SELECT EXTRACT(EPOCH FROM (j.finished_at - j.started_at))::int FROM jobs j WHERE j.scraper_id = s.id AND j.status='done' ORDER BY j.id DESC LIMIT 1) AS last_duration
    FROM scrapers s ORDER BY s.name`);
  const sparkQ = await db.query(`
    SELECT scraper_id, date_trunc('day', created_at) AS day, count(*) AS n
    FROM jobs WHERE created_at > now() - interval '7 days' AND status='done'
    GROUP BY 1, 2`);
  const sparkBy = {};
  for (const r of sparkQ.rows) {
    sparkBy[r.scraper_id] = sparkBy[r.scraper_id] || {};
    sparkBy[r.scraper_id][new Date(r.day).toISOString().slice(0, 10)] = parseInt(r.n, 10);
  }
  const last7days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    last7days.push(d.toISOString().slice(0, 10));
  }
  const pulse = pulseQ.rows.map(s => ({
    ...s,
    rowCount: perSourceCounts[s.name] || 0,
    spark: last7days.map(d => (sparkBy[s.id] && sparkBy[s.id][d]) || 0),
  }));

  // Top materiais (todos os fornecedores)
  let topMaterials = [];
  try {
    const unionSql = SLAB_TABLES.map(t => `SELECT item_name, count(*)::int AS n FROM ${t} WHERE item_name IS NOT NULL GROUP BY 1`).join(' UNION ALL ');
    const r = await db.query(`SELECT item_name, sum(n)::int AS n FROM (${unionSql}) u GROUP BY 1 ORDER BY n DESC LIMIT 6`);
    topMaterials = r.rows;
  } catch (_) {}

  // Top categorias
  let topCategories = [];
  try {
    const unionSql = SLAB_TABLES.map(t => `SELECT category_name, count(*)::int AS n FROM ${t} WHERE category_name IS NOT NULL AND category_name <> '' GROUP BY 1`).join(' UNION ALL ');
    const r = await db.query(`SELECT category_name, sum(n)::int AS n FROM (${unionSql}) u GROUP BY 1 ORDER BY n DESC LIMIT 6`);
    topCategories = r.rows;
  } catch (_) {}

  // Distribuição por location (agregada de todos)
  let locDist = { labels: [], values: [] };
  try {
    const unionSql = SLAB_TABLES.map(t => `SELECT coalesce(NULLIF(location, ''), 'sem local') AS location, count(*)::int AS n FROM ${t} GROUP BY 1`).join(' UNION ALL ');
    const r = await db.query(`SELECT location, sum(n)::int AS n FROM (${unionSql}) u GROUP BY 1 ORDER BY n DESC LIMIT 6`);
    locDist = { labels: r.rows.map(x => x.location), values: r.rows.map(x => x.n) };
  } catch (_) {}

  // Movimentação recente (últimas 24h)
  const recentMovsQ = await db.query(`
    SELECT m.kind, m.item_name, m.prev_value, m.next_value, m.detected_at, s.name AS scraper_name, s.id AS scraper_id
    FROM movements m JOIN scrapers s ON s.id = m.scraper_id
    WHERE m.detected_at > now() - interval '7 days'
    ORDER BY m.detected_at DESC LIMIT 8`);

  // Próximas execuções
  const scheduledQ = await db.query(`SELECT id, name, schedule FROM scrapers WHERE enabled AND schedule IS NOT NULL`);
  const upcoming = scheduledQ.rows
    .map(s => {
      try {
        const it = cronParser.parseExpression(s.schedule, { tz: 'America/Sao_Paulo' });
        const next = it.next().toDate();
        return { ...s, next };
      } catch (e) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.next - b.next)
    .slice(0, 5)
    .map(s => {
      const diffMs = s.next - new Date();
      const min = Math.round(diffMs / 60000);
      let label;
      if (min < 1) label = 'agora';
      else if (min < 60) label = `${min}min`;
      else if (min < 60 * 24) label = `${Math.round(min / 60)}h`;
      else label = `${Math.round(min / (60 * 24))}d`;
      return {
        id: s.id, name: s.name, schedule: s.schedule,
        nextLabel: label,
        nextDate: s.next.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
        hourMark: s.next.getHours() + s.next.getMinutes() / 60,
      };
    });

  res.render('dashboard', {
    kpis, pulse, topMaterials, topCategories, locDist,
    recentMovs: recentMovsQ.rows, upcoming,
    veiningHero: veining({ seed: 'hero-' + new Date().toISOString().slice(0,10), w: 1400, h: 360, strokes: 6 }),
  });
});

// ================== SCRAPERS ==================
app.get('/scrapers', requireAuth, async (req, res) => {
  const { rows } = await db.query(`
    SELECT s.*,
      (SELECT j.status FROM jobs j WHERE j.scraper_id = s.id ORDER BY j.created_at DESC LIMIT 1) AS last_status,
      (SELECT j.finished_at FROM jobs j WHERE j.scraper_id = s.id ORDER BY j.created_at DESC LIMIT 1) AS last_run
    FROM scrapers s ORDER BY s.name`);
  res.render('scrapers', { scrapers: rows });
});

app.get('/scrapers/new', requireAuth, (req, res) => {
  res.render('scraper_form', { scraper: null, error: null });
});

app.get('/scrapers/:id/edit', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM scrapers WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).send('Não encontrado');
  res.render('scraper_form', { scraper: rows[0], error: null });
});

app.post('/scrapers', requireAuth, async (req, res) => {
  const { id, name, description, url, actions, schedule, enabled } = req.body;
  let parsedActions;
  try {
    parsedActions = JSON.parse(actions || '[]');
    if (!Array.isArray(parsedActions)) throw new Error('actions deve ser array');
  } catch (e) {
    return res.render('scraper_form', {
      scraper: { id, name, description, url, actions, schedule, enabled },
      error: 'JSON de actions inválido: ' + e.message,
    });
  }
  const isEnabled = enabled === 'on' || enabled === true;
  const sched = schedule && schedule.trim() ? schedule.trim() : null;
  if (sched) {
    try { cronParser.parseExpression(sched); }
    catch (e) {
      return res.render('scraper_form', {
        scraper: { id, name, description, url, actions, schedule, enabled },
        error: 'Cron inválido: ' + e.message,
      });
    }
  }
  if (id) {
    await db.query(
      `UPDATE scrapers SET name=$1, description=$2, url=$3, actions=$4, schedule=$5, enabled=$6, updated_at=now() WHERE id=$7`,
      [name, description, url, parsedActions, sched, isEnabled, id]
    );
    audit(req.session.user, 'scraper.update', `scrapers/${id}`, { name }, req.ip);
  } else {
    await db.query(
      `INSERT INTO scrapers (name, description, url, actions, schedule, enabled) VALUES ($1,$2,$3,$4,$5,$6)`,
      [name, description, url, parsedActions, sched, isEnabled]
    );
    audit(req.session.user, 'scraper.create', null, { name }, req.ip);
  }
  res.redirect('/scrapers');
});

app.post('/scrapers/:id/delete', requireAuth, async (req, res) => {
  await db.query('DELETE FROM scrapers WHERE id = $1', [req.params.id]);
  audit(req.session.user, 'scraper.delete', `scrapers/${req.params.id}`, {}, req.ip);
  res.redirect('/scrapers');
});

app.post('/scrapers/:id/run', requireAuth, async (req, res) => {
  const scraperId = parseInt(req.params.id, 10);
  const { rows } = await db.query(
    `INSERT INTO jobs (scraper_id, status, triggered_by) VALUES ($1, 'queued', 'manual') RETURNING id`,
    [scraperId]
  );
  const jobId = rows[0].id;
  await scrapeQueue.add('run', { jobId, scraperId });
  audit(req.session.user, 'scraper.run', `scrapers/${scraperId}`, { jobId }, req.ip);
  res.redirect(`/scrapers/${scraperId}/results`);
});

app.get('/scrapers/:id/results', requireAuth, async (req, res) => {
  const scraperId = req.params.id;
  const scraperQ = await db.query('SELECT * FROM scrapers WHERE id = $1', [scraperId]);
  if (!scraperQ.rows[0]) return res.status(404).send('Não encontrado');
  const jobsQ = await db.query(
    `SELECT * FROM jobs WHERE scraper_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [scraperId]
  );
  const resultsQ = await db.query(
    `SELECT * FROM results WHERE scraper_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [scraperId]
  );
  const runningQ = await db.query(
    `SELECT * FROM jobs WHERE scraper_id = $1 AND status IN ('running','queued') ORDER BY id DESC LIMIT 1`,
    [scraperId]
  );
  res.render('results', {
    scraper: scraperQ.rows[0],
    jobs: jobsQ.rows,
    results: resultsQ.rows,
    runningJob: runningQ.rows[0] || null,
  });
});

// HTMX: progresso parcial
app.get('/scrapers/:id/progress', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM jobs WHERE scraper_id = $1 AND status IN ('running','queued') ORDER BY id DESC LIMIT 1`,
    [req.params.id]
  );
  if (!rows[0]) {
    res.setHeader('HX-Trigger', 'job-finished');
    return res.send('<div></div>');
  }
  res.render('partials/progress_card', { runningJob: rows[0] });
});

// ================== JOBS ==================
app.get('/jobs', requireAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const perPage = 50;
  const scraperId = req.query.scraper_id ? parseInt(req.query.scraper_id, 10) : null;
  const status = ['queued','running','done','failed'].includes(req.query.status) ? req.query.status : null;

  const where = []; const params = [];
  if (scraperId) { params.push(scraperId); where.push(`j.scraper_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`j.status = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalQ = await db.query(`SELECT count(*) AS n FROM jobs j ${whereSql}`, params);
  const total = parseInt(totalQ.rows[0].n, 10);

  const offset = (page - 1) * perPage;
  const listQ = await db.query(
    `SELECT j.id, j.scraper_id, s.name AS scraper_name, j.status, j.triggered_by,
      j.started_at, j.finished_at, j.error,
      EXTRACT(EPOCH FROM (j.finished_at - j.started_at))::int AS duration_s
    FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
    ${whereSql}
    ORDER BY j.id DESC LIMIT ${perPage} OFFSET ${offset}`, params);

  const scrapersQ = await db.query('SELECT id, name FROM scrapers ORDER BY name');
  const qsParts = [];
  if (scraperId) qsParts.push(`scraper_id=${scraperId}`);
  if (status) qsParts.push(`status=${status}`);

  res.render('jobs', {
    jobs: listQ.rows,
    scrapers: scrapersQ.rows,
    filters: { scraperId, status },
    pagination: {
      page, perPage, total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      qs: qsParts.join('&'),
    },
  });
});

// ================== DATA EXPLORER ==================
const SLAB_TEXT_COLS = ['serial_number','item_name','category_name','bundle','color','location','thickness','price_range','uom'];
const TABLES = {
  scrapers: { textCols: ['name','description','url','schedule'] },
  jobs:     { textCols: ['status','triggered_by','error'] },
  results:  { textCols: [] },
  encore_slabs:             { textCols: ['serial_number','item_name','category_name','product_form','location','uom'] },
  crs_slabs:                { textCols: SLAB_TEXT_COLS },
  nsr_slabs:                { textCols: SLAB_TEXT_COLS },
  granitedistributor_slabs: { textCols: SLAB_TEXT_COLS },
  vmcstone_slabs:           { textCols: SLAB_TEXT_COLS },
  zucchistones_slabs:       { textCols: SLAB_TEXT_COLS },
  movements: { textCols: ['kind','item_name','prev_value','next_value'] },
  slabs_history: { textCols: ['serial_number','item_name','bundle','color','location'] },
};

async function queryTableRows({ tableName, page = 1, perPage = 50, q = '' }) {
  const tableCfg = TABLES[tableName];
  const colsQ = await db.query(
    `SELECT column_name AS name, data_type AS type FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [tableName]);
  const columns = colsQ.rows.map(c => ({ name: c.name, type: c.type }));

  const params = [];
  let whereSql = '';
  if (q && tableCfg.textCols.length) {
    const conds = tableCfg.textCols.map(c => { params.push(`%${q}%`); return `${c}::text ILIKE $${params.length}`; });
    whereSql = `WHERE ${conds.join(' OR ')}`;
  }
  const totalQ = await db.query(`SELECT count(*) AS n FROM ${tableName} ${whereSql}`, params);
  const total = parseInt(totalQ.rows[0].n, 10);
  const offset = (page - 1) * perPage;
  const orderCol = columns.find(c => c.name === 'id') ? 'id DESC' : columns[0].name;
  const rowsQ = await db.query(`SELECT * FROM ${tableName} ${whereSql} ORDER BY ${orderCol} LIMIT ${perPage} OFFSET ${offset}`, params);
  return { columns, rows: rowsQ.rows, total };
}

app.get('/data', requireAuth, async (req, res) => {
  const tableName = req.query.table && Object.prototype.hasOwnProperty.call(TABLES, req.query.table) ? req.query.table : 'encore_slabs';
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const perPage = 50;
  const q = (req.query.q || '').toString().trim();

  const tablesList = await Promise.all(Object.keys(TABLES).map(async (t) => {
    const r = await db.query(`SELECT count(*) AS n FROM ${t}`);
    return { name: t, count: parseInt(r.rows[0].n, 10).toLocaleString('pt-BR') };
  }));
  const { columns, rows, total } = await queryTableRows({ tableName, page, perPage, q });

  const qsParts = [`table=${tableName}`];
  if (q) qsParts.push(`q=${encodeURIComponent(q)}`);

  res.render('data', {
    tables: tablesList, currentTable: tableName,
    columns, rows, total, q,
    pagination: {
      page, perPage, total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      qs: qsParts.join('&'),
    },
  });
});

// Export CSV
app.get('/data/export.csv', requireAuth, async (req, res) => {
  const tableName = req.query.table;
  if (!Object.prototype.hasOwnProperty.call(TABLES, tableName)) return res.status(400).send('tabela inválida');
  const q = (req.query.q || '').toString().trim();
  const { columns, rows } = await queryTableRows({ tableName, page: 1, perPage: 100000, q });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${tableName}_${new Date().toISOString().slice(0,10)}.csv"`);
  res.write('﻿'); // BOM pra Excel
  res.write(columns.map(c => `"${c.name}"`).join(',') + '\n');
  for (const row of rows) {
    const line = columns.map(c => {
      const v = row[c.name];
      if (v == null) return '';
      const s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
      return '"' + s.replace(/"/g, '""') + '"';
    }).join(',');
    res.write(line + '\n');
  }
  res.end();
  audit(req.session.user, 'data.export.csv', tableName, { rows: rows.length, q }, req.ip);
});

// ================== MOVEMENTS ==================
app.get('/movements', requireAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const perPage = 50;
  const scraperId = req.query.scraper_id ? parseInt(req.query.scraper_id, 10) : null;
  const kind = ['added','removed','price_changed','qty_changed'].includes(req.query.kind) ? req.query.kind : null;

  const where = []; const params = [];
  if (scraperId) { params.push(scraperId); where.push(`m.scraper_id = $${params.length}`); }
  if (kind) { params.push(kind); where.push(`m.kind = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalQ = await db.query(`SELECT count(*) AS n FROM movements m ${whereSql}`, params);
  const total = parseInt(totalQ.rows[0].n, 10);
  const offset = (page - 1) * perPage;

  const listQ = await db.query(
    `SELECT m.*, s.name AS scraper_name FROM movements m JOIN scrapers s ON s.id = m.scraper_id
     ${whereSql} ORDER BY m.detected_at DESC LIMIT ${perPage} OFFSET ${offset}`, params);

  const summary = await db.query(`
    SELECT kind, count(*)::int AS n FROM movements
    WHERE detected_at > now() - interval '7 days'
    GROUP BY kind`);
  const summaryMap = { added: 0, removed: 0, price_changed: 0, qty_changed: 0 };
  for (const r of summary.rows) summaryMap[r.kind] = r.n;

  const scrapersQ = await db.query('SELECT id, name FROM scrapers ORDER BY name');
  const qsParts = [];
  if (scraperId) qsParts.push(`scraper_id=${scraperId}`);
  if (kind) qsParts.push(`kind=${kind}`);

  res.render('movements', {
    movements: listQ.rows, scrapers: scrapersQ.rows,
    filters: { scraperId, kind },
    summary: summaryMap,
    pagination: {
      page, perPage, total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      qs: qsParts.join('&'),
    },
  });
});

// ================== SPOTLIGHT (HTMX) ==================
app.get('/spotlight', requireAuth, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.send('<div class="p-8 text-center text-sm text-stone-500">Comece a digitar pra buscar.</div>');

  const like = `%${q}%`;
  const [scrapersR, jobsR, slabsR] = await Promise.all([
    db.query(`SELECT id, name, description FROM scrapers WHERE name ILIKE $1 OR description ILIKE $1 LIMIT 5`, [like]),
    db.query(`SELECT j.id, s.name AS scraper_name, j.status FROM jobs j JOIN scrapers s ON s.id=j.scraper_id WHERE j.error ILIKE $1 OR s.name ILIKE $1 ORDER BY j.id DESC LIMIT 5`, [like]),
    db.query(`SELECT id, item_name, serial_number, color, item_id, 'encore' AS source FROM encore_slabs WHERE item_name ILIKE $1 OR serial_number ILIKE $1 ORDER BY id DESC LIMIT 5`, [like]).catch(() => ({ rows: [] })),
  ]);
  res.render('partials/spotlight_results', { scrapers: scrapersR.rows, jobs: jobsR.rows, slabs: slabsR.rows });
});

// ================== API TOKENS ==================
function shaHex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

app.get('/api-tokens', requireAuth, async (req, res) => {
  const { rows } = await db.query(`SELECT id, name, prefix, scopes, created_at, last_used_at, revoked_at FROM api_tokens ORDER BY id DESC`);
  const { newToken } = req.query;
  res.render('api_tokens', { tokens: rows, newToken: newToken || null });
});

app.post('/api-tokens', requireAuth, async (req, res) => {
  const name = (req.body.name || 'sem-nome').trim().slice(0, 80);
  const tokenRaw = 'hh_' + crypto.randomBytes(24).toString('base64url');
  const prefix = tokenRaw.slice(0, 12);
  const hash = shaHex(tokenRaw);
  await db.query(`INSERT INTO api_tokens (name, prefix, token_hash, scopes) VALUES ($1, $2, $3, ARRAY['read'])`, [name, prefix, hash]);
  audit(req.session.user, 'api_token.create', null, { name, prefix }, req.ip);
  res.redirect('/api-tokens?newToken=' + encodeURIComponent(tokenRaw));
});

app.post('/api-tokens/:id/revoke', requireAuth, async (req, res) => {
  await db.query(`UPDATE api_tokens SET revoked_at = now() WHERE id = $1`, [req.params.id]);
  audit(req.session.user, 'api_token.revoke', `tokens/${req.params.id}`, {}, req.ip);
  res.redirect('/api-tokens');
});

// ================== WEBHOOKS ==================
app.get('/webhooks', requireAuth, async (req, res) => {
  const { rows } = await db.query(`
    SELECT w.*, s.name AS scraper_name FROM webhooks w
    LEFT JOIN scrapers s ON s.id = w.scraper_id
    ORDER BY w.id DESC`);
  const scrapersQ = await db.query('SELECT id, name FROM scrapers ORDER BY name');
  res.render('webhooks', { webhooks: rows, scrapers: scrapersQ.rows });
});

app.post('/webhooks', requireAuth, async (req, res) => {
  const { url, scraper_id, events, secret } = req.body;
  const evs = (events || 'job.done,job.failed').split(',').map(e => e.trim()).filter(Boolean);
  const sid = scraper_id ? parseInt(scraper_id, 10) : null;
  await db.query(`INSERT INTO webhooks (url, scraper_id, events, secret) VALUES ($1, $2, $3, $4)`,
    [url, sid, evs, secret || null]);
  audit(req.session.user, 'webhook.create', null, { url, sid }, req.ip);
  res.redirect('/webhooks');
});

app.post('/webhooks/:id/delete', requireAuth, async (req, res) => {
  await db.query(`DELETE FROM webhooks WHERE id = $1`, [req.params.id]);
  audit(req.session.user, 'webhook.delete', `webhooks/${req.params.id}`, {}, req.ip);
  res.redirect('/webhooks');
});

// ================== AUDIT ==================
app.get('/audit', requireAuth, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 200`);
  res.render('audit', { entries: rows });
});

// ================== API v1 (Bearer) ==================
async function requireApiToken(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Bearer token required' });
  const token = m[1].trim();
  const hash = shaHex(token);
  const r = await db.query(`SELECT * FROM api_tokens WHERE token_hash = $1 AND revoked_at IS NULL`, [hash]);
  if (!r.rows[0]) return res.status(401).json({ error: 'invalid or revoked token' });
  req.token = r.rows[0];
  db.query(`UPDATE api_tokens SET last_used_at = now() WHERE id = $1`, [req.token.id]).catch(() => {});
  next();
}

app.get('/api/v1/scrapers', requireApiToken, async (req, res) => {
  const { rows } = await db.query(`SELECT id, name, description, url, schedule, enabled FROM scrapers ORDER BY name`);
  res.json({ data: rows });
});

app.get('/api/v1/jobs', requireApiToken, async (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const { rows } = await db.query(
    `SELECT j.id, j.scraper_id, s.name AS scraper_name, j.status, j.started_at, j.finished_at,
      j.rows_inserted, j.movements_added, j.movements_removed, j.movements_changed, j.error
     FROM jobs j JOIN scrapers s ON s.id = j.scraper_id
     ORDER BY j.id DESC LIMIT ${limit}`);
  res.json({ data: rows });
});

app.get('/api/v1/slabs', requireApiToken, async (req, res) => {
  const source = (req.query.source || '').toLowerCase();
  const map = { encore: 'encore_slabs', crs: 'crs_slabs', nsr: 'nsr_slabs', granitedistributor: 'granitedistributor_slabs', vmcstone: 'vmcstone_slabs', zucchistones: 'zucchistones_slabs' };
  const table = map[source];
  if (!table) return res.status(400).json({ error: 'source inválido', allowed: Object.keys(map) });
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || '100', 10)));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
  const { rows } = await db.query(`SELECT * FROM ${table} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`);
  res.json({ data: rows, source, limit, offset });
});

app.get('/api/v1/movements', requireApiToken, async (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '100', 10)));
  const { rows } = await db.query(
    `SELECT m.*, s.name AS scraper_name FROM movements m JOIN scrapers s ON s.id = m.scraper_id
     ORDER BY m.id DESC LIMIT ${limit}`);
  res.json({ data: rows });
});

// Dispara um run (usado pelo web, server-a-server). Bearer token, isento de CSRF.
app.post('/api/v1/scrapers/:id/run', requireApiToken, async (req, res) => {
  const scraperId = parseInt(req.params.id, 10);
  if (!Number.isInteger(scraperId) || scraperId <= 0) {
    return res.status(400).json({ error: 'id inválido' });
  }
  const s = await db.query('SELECT id FROM scrapers WHERE id = $1', [scraperId]);
  if (!s.rows[0]) return res.status(404).json({ error: 'scraper não encontrado' });
  const { rows } = await db.query(
    `INSERT INTO jobs (scraper_id, status, triggered_by) VALUES ($1, 'queued', 'manual') RETURNING id`,
    [scraperId]
  );
  const jobId = rows[0].id;
  await scrapeQueue.add('run', { jobId, scraperId });
  res.json({ data: { jobId, scraperId } });
});

// Handler 403 amigável quando CSRF falha
app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('login', { error: 'Sessão expirada ou token inválido. Faça login de novo.' });
  }
  if (err) {
    console.error('[panel] erro não tratado:', err);
    return res.status(500).json({ error: 'internal error' });
  }
  next();
});

const port = process.env.PORT || 3000;

bootstrapAdmin()
  .catch(err => console.error('[panel] bootstrap admin falhou:', err.message))
  .finally(() => {
    app.listen(port, () => console.log(`Painel rodando na porta ${port}`));
  });
