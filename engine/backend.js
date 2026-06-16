const express = require('express');
const bodyParser = require('body-parser');
const { request: pwRequest } = require('playwright');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const { Pool } = require('pg');

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 4 })
  : null;

async function updateProgress(jobId, fields) {
  if (!pool || !jobId) return;
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) return;
  params.push(jobId);
  try {
    await pool.query(`UPDATE jobs SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  } catch (e) {
    console.warn('[SCRAPER] updateProgress falhou:', e.message);
  }
}

const BROWSER_ACTIONS = new Set([
  'wait_for_selector', 'click', 'type', 'extract_text', 'extract_html', 'screenshot',
  'browser_get_json'
]);

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

function render(value, ctx) {
  if (typeof value !== 'string') return value;

  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, expr) => {
    if (expr === 'now') return String(Date.now());
    if (expr === 'random_int' || expr === 'random16') {
      return String(Math.floor(Math.random() * 1e16));
    }
    const parts = expr.split('.');
    const head = parts.shift();
    let obj;
    if (head === 'vars') obj = ctx.vars;
    else if (head === 'item') obj = ctx.item;
    else if (head === 'state') obj = ctx.state;
    else return match;
    let v = obj;
    for (const k of parts) v = v == null ? undefined : v[k];
    if (v === 'random16') return String(Math.floor(Math.random() * 1e16));
    if (v === 'now') return String(Date.now());
    return v == null ? '' : String(v);
  });
}

function hasBrowserActions(actions) {
  if (!Array.isArray(actions)) return false;
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    if (BROWSER_ACTIONS.has(a.type)) return true;
    if ((a.type === 'loop' || a.type === 'paginate_until') && hasBrowserActions(a.actions)) return true;
  }
  return false;
}

async function ensureBrowser(runCtx, url) {
  if (runCtx.page) return runCtx.page;
  runCtx.browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  runCtx.page = await runCtx.browser.newPage();
  if (url) {
    console.log('[SCRAPER] Acessando:', url);
    // domcontentloaded é mais rápido e não trava em páginas com JS polling
    // contínuo (ex: Cloudflare challenge). networkidle 'idle' opcional como
    // best-effort com timeout curto.
    await runCtx.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await runCtx.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  }
  return runCtx.page;
}

async function runActions(actions, ctx, runCtx) {
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;

    if (action.type === 'fetch_json' || action.type === 'fetch_text') {
      const url = render(action.url, ctx);
      const method = (action.method || 'GET').toUpperCase();
      const headers = action.headers
        ? Object.fromEntries(Object.entries(action.headers).map(([k, v]) => [k, render(v, ctx)]))
        : undefined;
      const params = action.query_params
        ? Object.fromEntries(Object.entries(action.query_params).map(([k, v]) => [k, render(v, ctx)]))
        : undefined;
      const reqOpts = { method, timeout: 60000 };
      if (headers) reqOpts.headers = headers;
      if (params) reqOpts.params = params;
      if (action.body_json !== undefined) {
        reqOpts.data = render(action.body_json, ctx);
      } else if (action.body_form !== undefined) {
        reqOpts.form = Object.fromEntries(
          Object.entries(action.body_form).map(([k, v]) => [k, render(v, ctx)])
        );
      }

      console.log(`[SCRAPER] ${action.type} ${method}:`, url.slice(0, 120));
      const r = await runCtx.api.fetch(url, reqOpts);
      if (!r.ok()) {
        const txt = (await r.text()).slice(0, 200);
        throw new Error(`${action.type} ${url} => HTTP ${r.status()} body=${txt}`);
      }

      let data;
      if (action.type === 'fetch_text') {
        data = await r.text();
      } else {
        const txt = await r.text();
        if (txt.trim().startsWith('<')) {
          throw new Error(`fetch_json ${url} retornou HTML (token expirado?): ${txt.slice(0, 160)}`);
        }
        try { data = JSON.parse(txt); }
        catch (e) {
          throw new Error(`fetch_json ${url} JSON inválido: ${txt.slice(0, 200)}`);
        }
      }

      if (action.save_as) ctx.state[action.save_as] = data;
      if (action.append_to) {
        const target = ctx.state[action.append_to];
        if (Array.isArray(target)) {
          if (Array.isArray(data)) target.push(...data);
          else target.push(data);
        } else {
          ctx.state[action.append_to] = Array.isArray(data) ? [...data] : [data];
        }
      }
      continue;
    }

    if (action.type === 'extract_match') {
      const fromKey = action.from;
      const src = ctx.state[fromKey];
      if (typeof src !== 'string') {
        throw new Error(`extract_match: state["${fromKey}"] não é string`);
      }
      const flags = action.flags || '';
      const re = new RegExp(action.pattern, flags);
      const m = src.match(re);
      if (!m) {
        if (action.required === false) continue;
        throw new Error(`extract_match: padrão não encontrado em "${fromKey}"`);
      }
      const group = action.group != null ? action.group : 1;
      let captured = m[group];
      if (action.parse === 'json') {
        try { captured = JSON.parse(captured); }
        catch (e) {
          try { captured = JSON.parse(Buffer.from(captured, 'utf-8').toString('utf-8').replace(/\\'/g, "'")); }
          catch (_) { throw new Error(`extract_match: JSON inválido na captura: ${e.message}`); }
        }
      }
      if (action.save_as) ctx.state[action.save_as] = captured;
      const len = Array.isArray(captured) ? captured.length : (typeof captured === 'string' ? captured.length : 1);
      console.log(`[SCRAPER] extract_match -> ${action.save_as}: ${len} ${Array.isArray(captured) ? 'itens' : 'chars'}`);
      continue;
    }

    if (action.type === 'paginate_until') {
      // Paginação programática: executa sub-actions enquanto state[guard] for true ou < target
      const max = action.max_pages || 50;
      const target = action.until_count_in;
      const targetField = action.target_count_field;
      let i = 0;
      while (i < max) {
        const targetCount = target ? (ctx.state[target] && ctx.state[target][targetField]) : null;
        const currentCount = action.current_count_in
          ? (Array.isArray(ctx.state[action.current_count_in]) ? ctx.state[action.current_count_in].length : 0)
          : i;
        if (targetCount && currentCount >= targetCount) break;
        const pageOffset = action.page_offset != null ? Number(action.page_offset) : 0;
        ctx.vars[action.page_var || 'page'] = String(i + pageOffset);
        await runActions(action.actions || [], ctx, runCtx);
        i++;
        if (action.stop_when_empty && action.current_count_in) {
          const after = Array.isArray(ctx.state[action.current_count_in]) ? ctx.state[action.current_count_in].length : 0;
          if (after === currentCount) break;
        }
      }
      continue;
    }

    if (action.type === 'loop') {
      const arr = getPath(ctx.state, action.over);
      if (!Array.isArray(arr)) {
        throw new Error(`loop: state["${action.over}"] não é array`);
      }
      let items = arr;
      if (action.dedupe_by) {
        const seen = new Set();
        items = arr.filter((it) => {
          const k = it == null ? null : it[action.dedupe_by];
          if (k == null || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }
      const concurrency = Math.max(1, parseInt(action.concurrency || 1, 10));
      console.log(`[SCRAPER] loop sobre "${action.over}": ${items.length} items (dedupe_by=${action.dedupe_by || 'none'}, concurrency=${concurrency})`);

      // Reset/init progress no DB
      await updateProgress(runCtx.jobId, {
        progress_total: items.length,
        progress_done: 0,
        progress_label: `iterando ${action.over}`,
      });

      const runOne = async (item, idx) => {
        const childCtx = { ...ctx, item };
        try {
          await runActions(action.actions || [], childCtx, runCtx);
        } catch (err) {
          console.warn(`[SCRAPER] loop item ${idx} falhou: ${err.message}`);
          if (action.on_error === 'stop') throw err;
        }
      };

      let done = 0;
      const tick = async () => {
        done++;
        if (done % 10 === 0 || done === items.length) {
          if (done % 50 === 0) console.log(`[SCRAPER] loop progresso ${done}/${items.length}`);
          await updateProgress(runCtx.jobId, { progress_done: done });
        }
      };

      if (concurrency === 1) {
        for (let i = 0; i < items.length; i++) {
          await runOne(items[i], i + 1);
          await tick();
        }
      } else {
        let cursor = 0;
        const workers = Array.from({ length: concurrency }, async () => {
          while (true) {
            const idx = cursor++;
            if (idx >= items.length) return;
            await runOne(items[idx], idx + 1);
            await tick();
          }
        });
        await Promise.all(workers);
      }
      continue;
    }

    if (action.type === 'accumulate') {
      const src = getPath(ctx.state, action.from);
      if (!Array.isArray(src)) {
        if (action.required === false) continue;
        if (src == null) continue;
        throw new Error(`accumulate: state path "${action.from}" não é array (got ${typeof src})`);
      }
      if (!Array.isArray(ctx.state[action.into])) ctx.state[action.into] = [];
      ctx.state[action.into].push(...src);
      continue;
    }

    if (action.type === 'save_rows') {
      // No-op no engine; o worker é quem persiste em SQL.
      // Apenas logamos pra rastreio.
      const arr = ctx.state[action.from];
      const n = Array.isArray(arr) ? arr.length : 0;
      console.log(`[SCRAPER] save_rows declarado: from="${action.from}" table="${action.table}" rows=${n}`);
      continue;
    }

    if (action.type === 'set_var') {
      ctx.vars[action.name] = render(action.value, ctx);
      continue;
    }

    if (action.type === 'browser_get_json') {
      // Navega via browser real (Playwright + Chromium). Para sites atrás de
      // Cloudflare interactive challenge, navegar DIRETO no URL JSON e aguardar
      // o browser renderizar o JSON em <pre> (Chrome faz isso nativamente para
      // application/json). O Cloudflare libera após executar o JS challenge.
      const url = render(action.url, ctx);
      const page = await ensureBrowser(runCtx, runCtx.initialUrl);
      console.log(`[SCRAPER] browser_get_json:`, url.slice(0, 120));

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      const maxWaitMs = action.wait_ms || 45000;
      try {
        await page.waitForFunction(() => {
          const pre = document.querySelector('pre');
          if (!pre) return false;
          const t = (pre.textContent || '').trim();
          return t.length > 0 && (t[0] === '[' || t[0] === '{');
        }, { timeout: maxWaitMs });
      } catch (e) {
        // Captura snapshot para debug
        const title = await page.title().catch(() => '?');
        const head = (await page.locator('body').innerText().catch(() => '')).slice(0, 200);
        throw new Error(`browser_get_json ${url} timeout aguardando JSON. title="${title}" body="${head}"`);
      }

      const txt = (await page.locator('pre').first().innerText()).trim();
      let data;
      try { data = JSON.parse(txt); }
      catch (e) {
        throw new Error(`browser_get_json ${url} JSON inválido: ${txt.slice(0, 200)}`);
      }
      if (action.save_as) ctx.state[action.save_as] = data;
      if (action.append_to) {
        const target = ctx.state[action.append_to];
        if (Array.isArray(target)) {
          if (Array.isArray(data)) target.push(...data); else target.push(data);
        } else {
          ctx.state[action.append_to] = Array.isArray(data) ? [...data] : [data];
        }
      }
      continue;
    }

    if (BROWSER_ACTIONS.has(action.type)) {
      const page = await ensureBrowser(runCtx, runCtx.initialUrl);

      if (action.type === 'wait_for_selector') {
        await page.waitForSelector(render(action.selector, ctx), { timeout: action.timeout || 30000 });
      }
      if (action.type === 'click') {
        await page.click(render(action.selector, ctx));
      }
      if (action.type === 'type') {
        await page.fill(render(action.selector, ctx), render(action.text || '', ctx));
      }
      if (action.type === 'extract_text') {
        const sel = render(action.selector || 'body', ctx);
        const el = await page.$(sel);
        if (el) {
          ctx.state[action.name || sel] = await el.innerText();
        } else {
          console.warn('[SCRAPER] seletor não encontrado:', sel);
        }
      }
      if (action.type === 'extract_html') {
        const sel = render(action.selector || 'body', ctx);
        const el = await page.$(sel);
        if (el) {
          ctx.state[action.name || sel] = await el.innerHTML();
        } else {
          console.warn('[SCRAPER] seletor não encontrado:', sel);
        }
      }
      if (action.type === 'screenshot') {
        const buf = await page.screenshot({ fullPage: true });
        ctx.state[action.name || 'screenshotBase64'] = buf.toString('base64');
      }
      continue;
    }

    console.warn('[SCRAPER] ação desconhecida:', action.type);
  }
}

app.post('/scrape', async (req, res) => {
  const { url, actions = [], vars = {}, job_id: jobId } = req.body || {};

  const ctx = { state: {}, vars: { ...vars }, item: null };
  const runCtx = {
    initialUrl: url,
    jobId,
    api: await pwRequest.newContext({
      extraHTTPHeaders: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
      }
    }),
    browser: null,
    page: null
  };

  try {
    if (!actions.length && !url) {
      return res.status(400).json({ success: false, error: 'sem url nem actions' });
    }
    if (url && hasBrowserActions(actions)) {
      await ensureBrowser(runCtx, url);
    }
    await runActions(actions, ctx, runCtx);

    return res.json({ success: true, data: ctx.state });
  } catch (err) {
    console.error('[SCRAPER] ERRO:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    try { await runCtx.api.dispose(); } catch (_) {}
    if (runCtx.browser) { try { await runCtx.browser.close(); } catch (_) {} }
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(4000, () => {
  console.log('Playwright Scraper rodando na porta 4000');
});
