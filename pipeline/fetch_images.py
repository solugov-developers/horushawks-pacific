#!/usr/bin/env python3
"""
Pipeline de imagens (roda no servidor, resumível):
  distinct image_url do slabs_history -> download -> auto-crop na chapa ->
  original recortado (lado maior <= 2000px, JPEG 90) + thumbnail (400px) ->
  upload S3 (bucket privado) -> registra em image_assets.

Chaves no S3 (sha1 da image_url de origem):
  originals/<sha1>.jpg  recorte na chapa, para o embedding do pareamento
  thumbs/<sha1>.jpg     miniatura servida ao app via /thumb/<sha1>

Resumível: só processa o que não está 'done' COM original_key (linhas 'done'
antigas, só com thumb, voltam pra fila até o histórico estar completo).
Tolerante a falha (marca 'failed' e segue). Servir é via /thumb (API mobile).
"""
import os, io, sys, time, hashlib
import requests, psycopg2, boto3
from PIL import Image
import numpy as np

BUCKET   = os.environ["S3_BUCKET"]
REGION   = os.environ.get("AWS_REGION", "us-east-1")
DSN      = os.environ["DATABASE_URL"]
THUMB_W  = int(os.environ.get("THUMB_W", "400"))
ORIG_MAX = int(os.environ.get("ORIG_MAX", "2000"))  # lado maior do original recortado
ORIG_Q   = int(os.environ.get("ORIG_Q", "90"))
SLEEP    = float(os.environ.get("SLEEP", "0.2"))   # gentil com a prod
SCRAPER  = os.environ.get("SCRAPER", "").strip()    # só URLs de uma fonte (ex.: pacshore); vazio = todas
ONLY_NEW = os.environ.get("ONLY_NEW", "") == "1"    # 1 = ignora linhas 'done' sem original (sem backfill)
UA       = "Mozilla/5.0 (compatible; HorusHawksImagePipeline/1.0)"

s3 = boto3.client("s3", region_name=REGION)
db = psycopg2.connect(DSN); db.autocommit = True

def reconnect():
    global db
    try: db.close()
    except Exception: pass
    db = psycopg2.connect(DSN); db.autocommit = True


def ensure_table():
    with db.cursor() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS image_assets(
          source_url text PRIMARY KEY, thumb_key text, status text NOT NULL DEFAULT 'pending',
          width int, height int, bytes int, error text, updated_at timestamptz NOT NULL DEFAULT now())""")
        c.execute("ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS original_key text")


def worklist():
    """URLs a processar. SCRAPER restringe a uma fonte; ONLY_NEW=1 deixa de fora
    as linhas já 'done' (só thumb) — útil para rodar uma fonte nova sem puxar
    o backfill dos originais de todo o histórico."""
    scraper_join = "JOIN scrapers s ON s.id = h.scraper_id AND s.name = %s" if SCRAPER else ""
    done_cond = ("a.status = 'done'" if ONLY_NEW
                 else "a.status = 'done' AND a.original_key IS NOT NULL")
    params = (SCRAPER,) if SCRAPER else ()
    with db.cursor() as c:
        c.execute(f"""
          SELECT DISTINCT h.image_url FROM slabs_history h {scraper_join}
          WHERE h.image_url IS NOT NULL AND h.image_url !~ 'sps-files/$'
            AND NOT EXISTS (SELECT 1 FROM image_assets a
                            WHERE a.source_url = h.image_url AND {done_cond})
          ORDER BY (SELECT a.status FROM image_assets a WHERE a.source_url = h.image_url) IS NULL DESC,
                   h.image_url""", params)   # nunca vistas primeiro; depois done-sem-original e failed
        return [r[0] for r in c.fetchall()]


def _longest_band(vals, rel=0.72):
    """maior faixa contígua de índices com valor > rel*max -> (ini, fim, tam)."""
    thr = vals.max() * rel
    a = b = s = run = best = 0
    bi = bj = 0
    for i, v in enumerate(vals > thr):
        if v:
            if run == 0: s = i
            run += 1
            if run > best: best = run; bi = s; bj = i
        else:
            run = 0
    return bi, bj, best


def autocrop(im):
    """Recorta a chapa. Pedra clara: faixa de brilho. Pedra escura (brilho falha):
    cai pro miolo (12%-90%). Swatch liso: mantém ~tudo."""
    W, H = im.size
    g = np.asarray(im.convert("L"), dtype=float)
    ay, by, bl = _longest_band(g.mean(1))
    if bl < H * 0.25:                       # brilho não achou a chapa (escura) -> miolo
        ay, by = int(H * 0.12), int(H * 0.90)
    ax, bx, blx = _longest_band(g[ay:by + 1, :].mean(0))
    if blx < W * 0.40:                      # colunas inconclusivas -> largura cheia
        ax, bx = 0, W - 1
    p = 4
    return im.crop((max(0, ax - p), max(0, ay - p), min(W, bx + p), min(H, by + p)))


Image.MAX_IMAGE_PIXELS = 60_000_000  # rejeita bomba de descompressão (vira 'failed')

def process(url):
    """download -> crop -> original (<= ORIG_MAX) + thumb (THUMB_W) -> S3.
    Retorna (thumb_key, original_key, thumb_w, thumb_h, thumb_bytes)."""
    r = requests.get(url, timeout=30, headers={"User-Agent": UA})
    r.raise_for_status()
    im = Image.open(io.BytesIO(r.content))
    im.draft("RGB", (ORIG_MAX, ORIG_MAX))  # decode JPEG já reduzido (bounda memória)
    im = im.convert("RGB")
    if max(im.size) > ORIG_MAX:            # limita antes do numpy/crop -> sem OOM
        im.thumbnail((ORIG_MAX, ORIG_MAX), Image.LANCZOS)
    im = autocrop(im)                      # já está com lado maior <= ORIG_MAX
    sha = hashlib.sha1(url.encode()).hexdigest()

    # 1) original recortado (fonte pro embedding; URLs dos fornecedores expiram)
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=ORIG_Q, optimize=True)
    orig_key = "originals/" + sha + ".jpg"
    s3.put_object(Bucket=BUCKET, Key=orig_key, Body=buf.getvalue(), ContentType="image/jpeg")
    del buf

    # 2) thumbnail (o que o app recebe)
    ratio = THUMB_W / im.size[0]
    im = im.resize((THUMB_W, max(1, round(im.size[1] * ratio))), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=82, optimize=True)
    data = buf.getvalue()
    key = "thumbs/" + sha + ".jpg"
    s3.put_object(Bucket=BUCKET, Key=key, Body=data, ContentType="image/jpeg")
    return key, orig_key, im.size[0], im.size[1], len(data)


def mark_done(url, key, orig_key, w, h, n):
    with db.cursor() as c:
        c.execute("""INSERT INTO image_assets(source_url,thumb_key,original_key,status,width,height,bytes,updated_at)
                     VALUES(%s,%s,%s,'done',%s,%s,%s,now())
                     ON CONFLICT(source_url) DO UPDATE SET thumb_key=EXCLUDED.thumb_key,
                       original_key=EXCLUDED.original_key,
                       status='done',width=EXCLUDED.width,height=EXCLUDED.height,
                       bytes=EXCLUDED.bytes,error=NULL,updated_at=now()""", (url, key, orig_key, w, h, n))


def mark_failed(url, err):
    with db.cursor() as c:
        # Linha já 'done' (thumb no S3, só faltava o original) não é rebaixada:
        # o app continua com a miniatura e o job tenta o original de novo na próxima.
        c.execute("""INSERT INTO image_assets(source_url,status,error,updated_at)
                     VALUES(%s,'failed',%s,now())
                     ON CONFLICT(source_url) DO UPDATE SET
                       status=CASE WHEN image_assets.status='done' THEN 'done' ELSE 'failed' END,
                       error=EXCLUDED.error,updated_at=now()""", (url, str(err)[:500]))


def main():
    ensure_table()
    urls = worklist()
    total = len(urls)
    print(f"[imgpipe] a processar: {total} (scraper={SCRAPER or 'todas'}, only_new={ONLY_NEW})", flush=True)
    ok = fail = 0
    for i, url in enumerate(urls, 1):
        try:
            key, orig_key, w, h, n = process(url)
            mark_done(url, key, orig_key, w, h, n); ok += 1
        except Exception as e:
            try:
                mark_failed(url, e); fail += 1
            except Exception:
                reconnect()                       # blip de DB não derruba o job
                try: mark_failed(url, e); fail += 1
                except Exception: pass
        if i % 100 == 0 or i == total:
            print(f"[imgpipe] {i}/{total} ok={ok} fail={fail}", flush=True)
        time.sleep(SLEEP)
    print(f"[imgpipe] DONE ok={ok} fail={fail}", flush=True)


if __name__ == "__main__":
    main()
