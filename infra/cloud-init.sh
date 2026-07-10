#!/bin/bash
# ============================================================
# Cloud-init: roda 1× quando a instância sobe pela 1ª vez.
# Instala Docker + Caddy, prepara swap, cria diretório do projeto.
# O git clone + bootstrap do app é feito pelo `infra/deploy.sh`
# (executado da sua máquina via ssh, depois do terraform apply).
# ============================================================

set -euo pipefail

LOGFILE=/var/log/horushawks-bootstrap.log
exec > >(tee -a "$LOGFILE") 2>&1

echo "[$(date)] cloud-init iniciando"

# ──────────────────────────────────────────────────────────────────
# 1. Swap de 2 GB — essencial pra caber Postgres + Playwright em 2GB RAM
# ──────────────────────────────────────────────────────────────────
if [ ! -f /swapfile ]; then
  echo "criando swapfile 2G"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.d/99-horushawks.conf
fi

# ──────────────────────────────────────────────────────────────────
# 2. Pacotes base
# ──────────────────────────────────────────────────────────────────
dnf update -y
dnf install -y docker git htop awscli openssl

# ──────────────────────────────────────────────────────────────────
# 3. Docker — daemon + compose plugin
# ──────────────────────────────────────────────────────────────────
systemctl enable --now docker
usermod -aG docker ec2-user

# docker compose v2 plugin (Amazon Linux 2023 não traz por default)
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Também simbólico para invocação direta `docker-compose`
ln -sf /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose

# ──────────────────────────────────────────────────────────────────
# 4. Caddy — reverse proxy + TLS auto via Let's Encrypt
# ──────────────────────────────────────────────────────────────────
dnf install -y 'dnf-command(copr)' || true
dnf copr enable -y @caddy/caddy
dnf install -y caddy

# Caddyfile será sobrescrito pelo deploy.sh
cat > /etc/caddy/Caddyfile <<'EOF'
# Placeholder. Sobrescrito pelo deploy.
:80 {
  respond "HorusHawks bootstrap em andamento. Aguarde deploy completo." 503
}
EOF

systemctl enable --now caddy

# ──────────────────────────────────────────────────────────────────
# 5. Estrutura do projeto
# ──────────────────────────────────────────────────────────────────
mkdir -p /opt/horushawks
chown ec2-user:ec2-user /opt/horushawks

# ──────────────────────────────────────────────────────────────────
# 6. Unattended security updates
# ──────────────────────────────────────────────────────────────────
dnf install -y dnf-automatic
sed -i 's/^apply_updates = no/apply_updates = yes/' /etc/dnf/automatic.conf || true
systemctl enable --now dnf-automatic.timer

# ──────────────────────────────────────────────────────────────────
# 7. Marca conclusão
# ──────────────────────────────────────────────────────────────────
touch /var/lib/horushawks-bootstrap-done
echo "[$(date)] cloud-init concluído"
echo ""
echo "PRÓXIMO PASSO: rode ./infra/deploy.sh da sua máquina pra fazer o deploy do código."
