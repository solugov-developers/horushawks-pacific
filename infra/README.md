# HorusHawks · Deploy em AWS Lightsail

Setup completo de produção via AWS CLI. Custo: ~$10/mês com runway de ~9 anos no crédito Activate.

```
arquitetura:
  Lightsail $10 (small_3_0) — us-east-1
    ├── 1 vCPU, 2 GB RAM, 60 GB SSD, 3 TB transfer/mês
    ├── Amazon Linux 2023
    ├── Caddy (TLS auto via Let's Encrypt + reverse proxy + headers)
    └── docker compose
        ├── postgres (256 MB)
        ├── redis    (256 MB)
        ├── engine   (Playwright, 700 MB)
        ├── worker   (single concurrency, retries, reaper)
        ├── scheduler
        ├── panel    (EJS, :3001 só localhost)
        └── web      (Next.js, :3000 só localhost)
```

---

## Pré-requisitos

1. **Conta AWS com créditos Activate** (você tem $1.100)
2. **AWS CLI v2** (`brew install awscli`)
3. **Domínio** opcional mas recomendado (registrado em qualquer registrar)
4. **IAM user** com policy `AmazonLightsailFullAccess`

---

## Passo a passo

### 1. Criar IAM user + access key

No [console IAM](https://console.aws.amazon.com/iam/users):
1. **Create user** → `horushawks-terraform` (sem console access)
2. **Attach policies directly** → `AmazonLightsailFullAccess` (busque e marque)
3. Após criar, vai em **Security credentials** → **Create access key** → escolhe **CLI**
4. Copia **Access Key ID** + **Secret Access Key**

### 2. Configurar AWS CLI localmente

```bash
aws configure
# AWS Access Key ID: AKIA...
# AWS Secret Access Key: ...
# Default region name: us-east-1
# Default output format: json
```

### 3. Gerar SSH key local

```bash
ssh-keygen -t ed25519 -C "horushawks-deploy" -f ~/.ssh/horushawks-ssh -N ""
chmod 600 ~/.ssh/horushawks-ssh
```

### 4. Configurar secrets locais

```bash
# .env de produção (gitignored)
cp .env.prod.example .env.prod
# Gere senhas fortes:
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -base64 24   # PANEL_PASSWORD
openssl rand -hex 64      # SESSION_SECRET
openssl rand -hex 64      # AUTH_SECRET
# Cole no .env.prod

# Tokens dos fornecedores (já deve existir local)
# Se não: cp db/secrets.sql.example db/secrets.sql && edite

# .env.deploy do deploy.sh
cp .env.deploy.example .env.deploy
# Edite EMAIL, APP_DOMAIN, ADMIN_DOMAIN; INSTANCE_IP fica vazio (provision.sh preenche)
```

### 5. Provisionar a infra

```bash
./infra/provision.sh
```

Esse comando faz tudo via AWS CLI:
- Importa SSH key pública pra Lightsail
- Cria instância `horushawks-prod` (small_3_0, Amazon Linux 2023)
- Aloca IP estático + anexa
- Configura firewall: SSH só seu IP, HTTP/HTTPS público
- Cria zona DNS Lightsail + records `app` e `admin` apontando pro IP
- Imprime os **nameservers** pra você apontar no registrar do domínio
- Atualiza `.env.deploy` com o IP

Tempo total: ~2-3 minutos.

### 6. Apontar nameservers no registrar

No painel onde você comprou `horushawks.com` (Registro.br, Cloudflare, GoDaddy, etc.), troque os nameservers pelos 4 do Lightsail que o provision.sh imprimiu.

Aguarde propagação (5–60min). Cheque com `dig app.horushawks.com NS`.

### 7. Gerar hash da senha do admin EJS (camada extra de auth)

Após DNS propagar, SSH na instância e gere:

```bash
ssh -i ~/.ssh/horushawks-ssh ec2-user@<IP>
sudo caddy hash-password --plaintext "sua-senha-forte"
# Copia o hash $2a$14$… → cola no .env.deploy → ADMIN_BASIC_HASH
exit
```

### 8. Primeiro deploy

```bash
./infra/deploy.sh first-time
```

Esse comando:
- Aguarda cloud-init concluir
- Faz rsync do código
- Sobe os 7 serviços (postgres + redis + engine + worker + scheduler + panel + web)
- Aplica as 8 migrations + secrets.sql
- Configura Caddy com TLS automático (Let's Encrypt)

Quando terminar, abra `https://app.horushawks.com` e faça login com `admin` + senha do `.env.prod`.

### 9. Deploys subsequentes

```bash
# Após mudar código:
git add -A && git commit -m "..."
./infra/deploy.sh update
```

---

## Comandos úteis

```bash
./infra/deploy.sh logs            # tail de todos os serviços
./infra/deploy.sh logs worker     # só worker
./infra/deploy.sh ssh             # SSH interativo
./infra/deploy.sh psql            # psql remoto
./infra/deploy.sh restart panel   # restart serviço específico
./infra/deploy.sh caddy           # só reconfigurar Caddy
```

---

## Backup

### Automático (recomendado)

No console Lightsail:
1. **Instances → horushawks-prod → Snapshots**
2. Habilite **Automatic snapshots** (~$2-3/mês)
3. Mantém 7 snapshots automáticos

### Manual

```bash
./infra/deploy.sh ssh
sudo docker compose exec postgres pg_dump -U scraper scrapers > /tmp/backup-$(date +%F).sql
exit
scp -i ~/.ssh/horushawks-ssh ec2-user@<IP>:/tmp/backup-*.sql ./backups/
```

---

## Destruir infra (devolver crédito)

```bash
# Cuidado: apaga tudo, inclusive dados
aws lightsail delete-instance --instance-name horushawks-prod
aws lightsail release-static-ip --static-ip-name horushawks-prod-ip
aws lightsail delete-key-pair --key-pair-name horushawks-ssh
aws lightsail delete-domain --domain-name horushawks.com
```

---

## Custos esperados

| Item | $/mês |
|---|---|
| Lightsail small_3_0 | $10 |
| Automatic snapshots (opcional) | $2-3 |
| DNS Lightsail (1 zona) | $0,50 |
| **Total** | **~$12** |

Com $1.100 = **~7-9 anos** de runway.

---

## Troubleshooting

### Caddy não emite cert TLS
- Verifique DNS apontando pro IP correto: `dig app.horushawks.com`
- Veja logs: `./infra/deploy.sh ssh` → `sudo journalctl -u caddy -f`
- Let's Encrypt rate limit: máx 5 certs/semana por domínio.

### Postgres OOM
```bash
./infra/deploy.sh ssh
free -h
# Se swap >50% usado, upgrade pra $20 tier:
#   aws lightsail open-instance-public-ports + recreate, ou
#   docker stats pra identificar quem consome
```

### Job preso em running
O reaper faz isso automático a cada 30min. Pra forçar:
```bash
./infra/deploy.sh psql
UPDATE jobs SET status='failed', error='manual reset' WHERE status='running';
```

### Trocar tier sem perder dados
Lightsail suporta upgrade in-place na mesma instância via snapshot. Veja:
[lightsail.aws.amazon.com/ls/docs/en_us/articles/amazon-lightsail-changing-instance-bundle](https://lightsail.aws.amazon.com/ls/docs/en_us/articles/amazon-lightsail-changing-instance-bundle)
