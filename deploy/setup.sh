#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 24.04 Hetzner box. Run as root:  bash setup.sh wisp.example.com
set -euo pipefail
DOMAIN="${1:?usage: setup.sh <domain>}"
apt-get update -y && apt-get install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
mkdir -p /opt/wisp && cd /opt/wisp
if [ ! -d .git ]; then echo ">> copy the repo into /opt/wisp (git clone or rsync), then re-run"; exit 1; fi
if [ ! -f .env.production ]; then
  cp .env.example .env.production
  sed -i "s#^WISP_MASTER_KEY=.*#WISP_MASTER_KEY=$(openssl rand -hex 32)#" .env.production
  sed -i "s#^NEXT_PUBLIC_SITE_URL=.*#NEXT_PUBLIC_SITE_URL=https://${DOMAIN}#" .env.production
  sed -i "s#^NEXT_PUBLIC_API_URL=.*#NEXT_PUBLIC_API_URL=https://api.${DOMAIN}#" .env.production
  echo "WISP_DOMAIN=${DOMAIN}" >> .env.production
  echo ">> edit /opt/wisp/.env.production (SOLANA_RPC_URL, WISP_TREASURY_SECRET), then: bash deploy/deploy.sh"
  exit 0
fi
bash deploy/deploy.sh
