'use server';

import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

/**
 * Toggle enabled/disabled de um scraper.
 */
export async function toggleScraperAction(formData: FormData) {
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new Error('id inválido');

  await db.execute(sql`UPDATE scrapers SET enabled = NOT enabled, updated_at = now() WHERE id = ${id}`);
  revalidatePath('/scrapers');
}

/**
 * Atualiza o cron schedule. Aceita string vazia (limpa) ou cron válido.
 * Validação básica: ex 'm h dom mon dow' ou '@hourly' etc.
 */
const CRON_RE = /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/;

export async function updateScheduleAction(formData: FormData) {
  const id = Number(formData.get('id'));
  const schedule = String(formData.get('schedule') ?? '').trim();
  if (!Number.isInteger(id) || id <= 0) throw new Error('id inválido');

  if (schedule !== '' && !CRON_RE.test(schedule) && !schedule.startsWith('@')) {
    throw new Error(`cron inválido: "${schedule}". Use formato '0 1 * * *' (5 campos).`);
  }
  const value = schedule === '' ? null : schedule;
  await db.execute(sql`UPDATE scrapers SET schedule = ${value}, updated_at = now() WHERE id = ${id}`);
  revalidatePath('/scrapers');
}

/**
 * Dispara um run agora (cria job pending + enfileira via panel).
 * Aqui chamamos diretamente o endpoint do panel pra reaproveitar o pipeline existente.
 */
export async function runNowAction(formData: FormData) {
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new Error('id inválido');

  // Cria job manualmente (mesmo que o panel faz internamente)
  // e enfileira via Redis. Ambos rodam dentro do worker network.
  // Daqui (server action), não temos rede docker — então chamamos o panel.
  const panelUrl = process.env.PANEL_URL || 'http://localhost:3001';
  const username = process.env.PANEL_USER || 'admin';
  const password = process.env.PANEL_PASSWORD || 'euler123';

  // login (HTTP 302) + run (HTTP 302)
  const loginRes = await fetch(`${panelUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
    redirect: 'manual',
  });
  const cookie = loginRes.headers.get('set-cookie');
  if (!cookie) throw new Error('login falhou — cookie não retornado');

  const runRes = await fetch(`${panelUrl}/scrapers/${id}/run`, {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0] },
    redirect: 'manual',
  });
  if (runRes.status !== 302 && runRes.status !== 200) {
    throw new Error(`run falhou: HTTP ${runRes.status}`);
  }

  revalidatePath('/scrapers');
}
