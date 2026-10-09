#!/usr/bin/env bash
# Build + (re)start. Safe to re-run. Keeps data/ (SQLite) and Caddy certs.
set -euo pipefail
cd "$(dirname "$0")/.."
ln -sf .env.production .env   # lets plain `docker compose ...` see WISP_DOMAIN
export $(grep -E '^WISP_DOMAIN=' .env.production | xargs)
git pull --ff-only 2>/dev/null || true
docker compose build --pull
docker compose up -d --remove-orphans
docker compose ps
echo ">> site: https://${WISP_DOMAIN}   api: https://api.${WISP_DOMAIN}   ws: wss://api.${WISP_DOMAIN}/ws"
