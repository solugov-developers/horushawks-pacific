#!/usr/bin/env bash
# ============================================================
# Provisiona infra do HorusHawks na AWS Lightsail via AWS CLI.
# Rode da sua MÁQUINA LOCAL após `aws configure`.
#
# Cria:
#   - Key pair Lightsail (importando ~/.ssh/horushawks-ssh.pub)
#   - Instância Lightsail (small_3_0, Amazon Linux 2023)
#   - IP estático grátis + attach
#   - Firewall: 22 (whitelist), 80, 443 (público)
#   - DNS zone + A records pra app.<domain> e admin.<domain>
#   - User-data com cloud-init.sh (Docker, Caddy, swap)
#
# Idempotente: re-rodar é seguro (skipa o que já existe).
# ============================================================

set -euo pipefail

# Configuração ---------------------------------------------
REGION="${REGION:-us-east-1}"
AZ="${AZ:-us-east-1a}"
INSTANCE_NAME="${INSTANCE_NAME:-horushawks-prod}"
BUNDLE_ID="${BUNDLE_ID:-small_3_0}"           # $10/mês — 2 GB RAM
BLUEPRINT_ID="${BLUEPRINT_ID:-amazon_linux_2023}"
KEY_NAME="${KEY_NAME:-horushawks-ssh}"
SSH_PUB="${SSH_PUB:-$HOME/.ssh/horushawks-ssh.pub}"
DOMAIN="${DOMAIN:-horushawks.com}"
SUBDOMAIN_APP="${SUBDOMAIN_APP:-app}"
SUBDOMAIN_ADMIN="${SUBDOMAIN_ADMIN:-admin}"
ALLOW_SSH_IP="${ALLOW_SSH_IP:-}"               # vazio = pega IP atual via checkip

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
CLOUDINIT_PATH="$SCRIPT_DIR/cloud-init.sh"

# Helpers --------------------------------------------------
log()    { echo "[$(date +%H:%M:%S)] $*"; }
have()   { command -v "$1" >/dev/null 2>&1; }
require_aws() {
  if ! have aws; then echo "aws cli não instalado. brew install awscli"; exit 1; fi
  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "AWS CLI não autenticado. Rode 'aws configure' primeiro."; exit 1
  fi
}

# Preconditions --------------------------------------------
require_aws
[ -f "$CLOUDINIT_PATH" ] || { echo "cloud-init.sh não encontrado em $CLOUDINIT_PATH"; exit 1; }
[ -f "$SSH_PUB" ] || { echo "SSH pub key não encontrada em $SSH_PUB. Gere com ssh-keygen -t ed25519 -f ~/.ssh/horushawks-ssh"; exit 1; }

if [ -z "$ALLOW_SSH_IP" ]; then
  ALLOW_SSH_IP=$(curl -s https://checkip.amazonaws.com)/32
  log "IP detectado pra whitelist SSH: $ALLOW_SSH_IP"
fi

# ──────────────────────────────────────────────────────────
# 1. Key pair (importar nossa pública)
# ──────────────────────────────────────────────────────────
log "[1/6] verificando key pair $KEY_NAME"
if aws lightsail get-key-pair --key-pair-name "$KEY_NAME" --region "$REGION" >/dev/null 2>&1; then
  log "  já existe"
else
  log "  importando $SSH_PUB"
  aws lightsail import-key-pair \
    --key-pair-name "$KEY_NAME" \
    --public-key-base64 "$(cat "$SSH_PUB")" \
    --region "$REGION" >/dev/null
  log "  importado ✓"
fi

# ──────────────────────────────────────────────────────────
# 2. Instância
# ──────────────────────────────────────────────────────────
log "[2/6] verificando instância $INSTANCE_NAME"
if aws lightsail get-instance --instance-name "$INSTANCE_NAME" --region "$REGION" >/dev/null 2>&1; then
  log "  já existe"
else
  log "  criando ($BUNDLE_ID, $BLUEPRINT_ID, AZ=$AZ)"
  aws lightsail create-instances \
    --instance-names "$INSTANCE_NAME" \
    --availability-zone "$AZ" \
    --blueprint-id "$BLUEPRINT_ID" \
    --bundle-id "$BUNDLE_ID" \
    --key-pair-name "$KEY_NAME" \
    --user-data "file://$CLOUDINIT_PATH" \
    --tags key=project,value=horushawks key=env,value=prod \
    --region "$REGION" >/dev/null
  log "  aguardando ficar running..."
  for i in $(seq 1 30); do
    state=$(aws lightsail get-instance --instance-name "$INSTANCE_NAME" --region "$REGION" \
      --query 'instance.state.name' --output text)
    [ "$state" = "running" ] && break
    sleep 4
  done
  [ "$state" = "running" ] || { log "  timeout esperando running (estado=$state)"; exit 1; }
  log "  running ✓"
fi

# ──────────────────────────────────────────────────────────
# 3. IP estático
# ──────────────────────────────────────────────────────────
STATIC_NAME="${INSTANCE_NAME}-ip"
log "[3/6] verificando IP estático $STATIC_NAME"
if aws lightsail get-static-ip --static-ip-name "$STATIC_NAME" --region "$REGION" >/dev/null 2>&1; then
  log "  já existe"
else
  log "  alocando"
  aws lightsail allocate-static-ip --static-ip-name "$STATIC_NAME" --region "$REGION" >/dev/null
fi

ATTACHED_TO=$(aws lightsail get-static-ip --static-ip-name "$STATIC_NAME" --region "$REGION" \
  --query 'staticIp.attachedTo' --output text 2>/dev/null || echo "")
if [ "$ATTACHED_TO" != "$INSTANCE_NAME" ]; then
  log "  anexando à $INSTANCE_NAME"
  aws lightsail attach-static-ip \
    --static-ip-name "$STATIC_NAME" \
    --instance-name "$INSTANCE_NAME" \
    --region "$REGION" >/dev/null
fi

INSTANCE_IP=$(aws lightsail get-static-ip --static-ip-name "$STATIC_NAME" --region "$REGION" \
  --query 'staticIp.ipAddress' --output text)
log "  IP: $INSTANCE_IP"

# ──────────────────────────────────────────────────────────
# 4. Firewall (Public ports)
# ──────────────────────────────────────────────────────────
log "[4/6] aplicando firewall (22→$ALLOW_SSH_IP, 80/443→público)"
aws lightsail put-instance-public-ports \
  --instance-name "$INSTANCE_NAME" \
  --region "$REGION" \
  --port-infos \
    "fromPort=22,toPort=22,protocol=TCP,cidrs=$ALLOW_SSH_IP" \
    "fromPort=80,toPort=80,protocol=TCP,cidrs=0.0.0.0/0" \
    "fromPort=443,toPort=443,protocol=TCP,cidrs=0.0.0.0/0" \
    >/dev/null
log "  ok"

# ──────────────────────────────────────────────────────────
# 5. DNS (Lightsail managed)
# ──────────────────────────────────────────────────────────
if [ -n "$DOMAIN" ]; then
  log "[5/6] configurando DNS pra $DOMAIN"

  # Lightsail DNS só funciona em us-east-1. Sempre lá.
  DNS_REGION="us-east-1"

  # Cria zona se não existir
  if aws lightsail get-domain --domain-name "$DOMAIN" --region "$DNS_REGION" >/dev/null 2>&1; then
    log "  zona já existe"
  else
    log "  criando zona"
    aws lightsail create-domain --domain-name "$DOMAIN" --region "$DNS_REGION" >/dev/null
  fi

  # Records
  for sub in "$SUBDOMAIN_APP" "$SUBDOMAIN_ADMIN"; do
    FQDN="$sub.$DOMAIN"
    log "  A record: $FQDN → $INSTANCE_IP"
    # Tenta criar; se já existe, atualiza
    if ! aws lightsail create-domain-entry \
      --domain-name "$DOMAIN" \
      --domain-entry "name=$FQDN,target=$INSTANCE_IP,type=A,isAlias=false" \
      --region "$DNS_REGION" >/dev/null 2>&1; then
      # Update via update-domain-entry (precisa do id)
      ENTRY_ID=$(aws lightsail get-domain --domain-name "$DOMAIN" --region "$DNS_REGION" \
        --query "domain.domainEntries[?name=='$FQDN' && type=='A'].id" --output text 2>/dev/null | head -1)
      if [ -n "$ENTRY_ID" ] && [ "$ENTRY_ID" != "None" ]; then
        aws lightsail update-domain-entry \
          --domain-name "$DOMAIN" \
          --domain-entry "id=$ENTRY_ID,name=$FQDN,target=$INSTANCE_IP,type=A,isAlias=false" \
          --region "$DNS_REGION" >/dev/null
      fi
    fi
  done

  log "  Nameservers da zona Lightsail (configure no registrar do $DOMAIN):"
  aws lightsail get-domain --domain-name "$DOMAIN" --region "$DNS_REGION" \
    --query 'domain.domainEntries[?type==`NS`].target' --output text | tr '\t' '\n' | sed 's/^/    /'
else
  log "[5/6] DOMAIN vazio — pulando DNS"
fi

# ──────────────────────────────────────────────────────────
# 6. Update .env.deploy
# ──────────────────────────────────────────────────────────
log "[6/6] atualizando .env.deploy com IP=$INSTANCE_IP"
ENV_DEPLOY="$SCRIPT_DIR/../.env.deploy"
if [ -f "$ENV_DEPLOY" ]; then
  if grep -q "^INSTANCE_IP=" "$ENV_DEPLOY"; then
    sed -i.bak "s|^INSTANCE_IP=.*|INSTANCE_IP=$INSTANCE_IP|" "$ENV_DEPLOY" && rm -f "$ENV_DEPLOY.bak"
  else
    echo "INSTANCE_IP=$INSTANCE_IP" >> "$ENV_DEPLOY"
  fi
  log "  .env.deploy atualizado"
fi

echo ""
echo "======================================================"
echo "  Provisionamento concluído"
echo "======================================================"
echo "  IP:        $INSTANCE_IP"
echo "  SSH:       ssh -i ~/.ssh/$KEY_NAME ec2-user@$INSTANCE_IP"
echo "  App URL:   https://$SUBDOMAIN_APP.$DOMAIN"
echo "  Admin URL: https://$SUBDOMAIN_ADMIN.$DOMAIN"
echo ""
echo "Próximo passo:"
echo "  1. (se DOMAIN configurado) Apontar os NS do registrar pros NS do Lightsail (printados acima)"
echo "  2. ./infra/deploy.sh first-time  → faz o deploy do código"
echo "======================================================"
