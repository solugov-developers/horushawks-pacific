#!/usr/bin/env bash
# ============================================================
# Deploy do HorusHawks pra Lightsail.
# Rode da sua MÁQUINA LOCAL, não da instância.
#
# Uso:
#   ./infra/deploy.sh first-time      # primeiro deploy completo
#   ./infra/deploy.sh update          # atualiza código + restart
#   ./infra/deploy.sh logs <serviço>  # tail dos logs
#   ./infra/deploy.sh ssh             # ssh interativo
#
# Pré-reqs:
#   - Terraform aplicado (instância no ar)
#   - INSTANCE_IP no .env.deploy
#   - SSH_KEY em ~/.ssh/<nome>.pem
# ============================================================

set -euo pipefail

cd "$(dirname "$0")/.."

# Configuração ----------------------------------------------------
if [ -f .env.deploy ]; then
  set -o allexport; source .env.deploy; set +o allexport
fi

INSTANCE_IP="${INSTANCE_IP:?defina INSTANCE_IP no .env.deploy ou export}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/horushawks-ssh.pem}"
SSH_USER="${SSH_USER:-ec2-user}"
REMOTE_DIR="${REMOTE_DIR:-/opt/horushawks}"
APP_DOMAIN="${APP_DOMAIN:-}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-}"
EMAIL="${EMAIL:-}"
ADMIN_BASIC_HASH="${ADMIN_BASIC_HASH:-}"

SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new $SSH_USER@$INSTANCE_IP"
SCP="scp -i $SSH_KEY -o StrictHostKeyChecking=accept-new"

# ----------------------------------------------------------------
# Sub-comandos
# ----------------------------------------------------------------
cmd_first_time() {
  echo "==> [1/7] Aguardando cloud-init terminar (até 10min)…"
  for i in $(seq 1 60); do
    if $SSH "test -f /var/lib/horushawks-bootstrap-done" 2>/dev/null; then
      echo "    bootstrap concluído ✓"; break
    fi
    sleep 10; echo "    ($i/60) ainda subindo…"
  done

  echo "==> [2/7] Enviando código (rsync)…"
  cmd_sync

  echo "==> [3/7] Enviando .env.prod + secrets…"
  if [ ! -f .env.prod ]; then
    echo "ERRO: .env.prod não existe. Copie .env.prod.example e preencha."
    exit 1
  fi
  $SCP .env.prod "$SSH_USER@$INSTANCE_IP:$REMOTE_DIR/.env"
  if [ -f db/secrets.sql ]; then
    $SCP db/secrets.sql "$SSH_USER@$INSTANCE_IP:$REMOTE_DIR/db/secrets.sql"
  fi

  echo "==> [4/7] Build + up dos serviços…"
  $SSH "cd $REMOTE_DIR && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build"

  echo "==> [5/7] Aplicando migrations…"
  for sql in db/init.sql db/002_encore.sql db/003_more_scrapers.sql db/004_platform.sql \
             db/005_movement_kinds_and_status.sql db/006_update_scraper_actions.sql \
             db/007_saved_queries.sql db/008_users_and_reaper.sql db/009_irgstone.sql \
             db/010_fix_column_maps.sql db/011_thestoneindustry.sql \
             db/012_tsi_source_key.sql \
             db/secrets.sql; do
    echo "    aplicando $sql…"
    $SSH "cd $REMOTE_DIR && docker compose exec -T postgres psql -U \$(grep POSTGRES_USER .env | cut -d= -f2) -d \$(grep POSTGRES_DB .env | cut -d= -f2) -v ON_ERROR_STOP=1 < $sql" || echo "    (já aplicada?)"
  done

  echo "==> [6/7] Configurando Caddy…"
  cmd_caddy

  echo "==> [7/7] Status final"
  $SSH "cd $REMOTE_DIR && docker compose ps"

  echo ""
  echo "✓ Deploy concluído!"
  echo "  App:   ${APP_DOMAIN:+https://$APP_DOMAIN}"
  echo "  Admin: ${ADMIN_DOMAIN:+https://$ADMIN_DOMAIN}"
  echo "  IP:    $INSTANCE_IP"
}

cmd_update() {
  echo "==> Sincronizando código…"
  cmd_sync
  echo "==> Rebuild + restart…"
  $SSH "cd $REMOTE_DIR && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build"
  echo "==> Status:"
  $SSH "cd $REMOTE_DIR && docker compose ps"
}

cmd_sync() {
  # Excluir node_modules, .next, .git
  rsync -az --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude '.env*' \
    --exclude 'db/secrets.sql' \
    --exclude 'infra/terraform/.terraform' \
    --exclude 'infra/terraform/terraform.tfstate*' \
    -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
    ./ "$SSH_USER@$INSTANCE_IP:$REMOTE_DIR/"
}

cmd_caddy() {
  if [ -z "$APP_DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "AVISO: APP_DOMAIN ou EMAIL ausentes em .env.deploy. Pulando Caddy."
    return
  fi
  if [ -z "$ADMIN_BASIC_HASH" ]; then
    echo "ADMIN_BASIC_HASH ausente. Gere com:"
    echo "  ssh $INSTANCE_IP 'caddy hash-password --plaintext SUA_SENHA'"
    return
  fi
  # Substitui placeholders
  TMP=$(mktemp)
  sed -e "s|{{APP_DOMAIN}}|$APP_DOMAIN|g" \
      -e "s|{{ADMIN_DOMAIN}}|$ADMIN_DOMAIN|g" \
      -e "s|{{EMAIL}}|$EMAIL|g" \
      -e "s|{{ADMIN_BASIC_HASH}}|$ADMIN_BASIC_HASH|g" \
      infra/caddy/Caddyfile.template > "$TMP"
  $SCP "$TMP" "$SSH_USER@$INSTANCE_IP:/tmp/Caddyfile"
  $SSH "sudo mv /tmp/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy"
  rm -f "$TMP"
  echo "    Caddy reconfigurado e recarregado."
}

cmd_logs() {
  SERVICE="${2:-}"
  if [ -z "$SERVICE" ]; then
    $SSH "cd $REMOTE_DIR && docker compose logs --tail 100 -f"
  else
    $SSH "cd $REMOTE_DIR && docker compose logs --tail 200 -f $SERVICE"
  fi
}

cmd_ssh() { $SSH; }

cmd_psql() {
  $SSH "cd $REMOTE_DIR && docker compose exec postgres psql -U \$(grep POSTGRES_USER .env | cut -d= -f2) -d \$(grep POSTGRES_DB .env | cut -d= -f2)"
}

cmd_restart() {
  $SSH "cd $REMOTE_DIR && docker compose restart ${2:-}"
}

# Rebuild forçado (sem cache) + recria o container de um serviço.
# Usado quando `update` fica preso em cache e não troca o container.
cmd_rebuild() {
  SERVICE="${2:-}"
  if [ -z "$SERVICE" ]; then echo "uso: ./infra/deploy.sh rebuild <serviço>"; return 1; fi
  echo "==> Sincronizando código…"
  cmd_sync
  echo "==> Rebuild --no-cache + force-recreate: $SERVICE"
  $SSH "cd $REMOTE_DIR && docker compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache $SERVICE && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate $SERVICE"
  echo "==> Status:"
  $SSH "cd $REMOTE_DIR && docker compose -f docker-compose.yml -f docker-compose.prod.yml ps $SERVICE"
}

# Roda um comando arbitrário no REMOTE_DIR da instância (diagnóstico/manutenção).
cmd_exec() {
  shift
  $SSH "cd $REMOTE_DIR && $*"
}

cmd_help() {
  echo "Comandos:"
  echo "  first-time          Primeiro deploy (cloud-init + tudo)"
  echo "  update              Sync + rebuild + restart"
  echo "  sync                Só rsync do código"
  echo "  caddy               Reconfigura Caddyfile"
  echo "  logs [serviço]      Tail dos logs"
  echo "  ssh                 SSH interativo"
  echo "  psql                psql do postgres remoto"
  echo "  restart [serviço]   Restart container(s)"
}

# Despacho ----------------------------------------------------
case "${1:-help}" in
  first-time|first)  cmd_first_time ;;
  update|deploy)     cmd_update ;;
  sync)              cmd_sync ;;
  caddy)             cmd_caddy ;;
  logs)              cmd_logs "$@" ;;
  ssh)               cmd_ssh ;;
  psql)              cmd_psql ;;
  restart)           cmd_restart "$@" ;;
  rebuild)           cmd_rebuild "$@" ;;
  exec)              cmd_exec "$@" ;;
  help|--help|-h|"") cmd_help ;;
  *)                 echo "Comando desconhecido: $1"; cmd_help; exit 1 ;;
esac
