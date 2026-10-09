# Deploying Wisp on a Hetzner VPS

Box: Hetzner Cloud **CX22** (2 vCPU, 4 GB, 40 GB NVMe, ~€4/mo), Ubuntu 24.04, location **Ashburn** (us-east, closest to most Solana RPC/validator infrastructure) or Falkenstein if you want EU. Add a Hetzner Cloud Firewall allowing 22, 80, 443. CX32 if you later run many agents on long-polls and the WebSocket.

```bash
# on the box, as root
git clone <your repo> /opt/wisp && cd /opt/wisp
bash deploy/setup.sh wisp.yourdomain.com     # installs docker, firewall, writes .env.production
nano .env.production                          # SOLANA_RPC_URL, WISP_TREASURY_SECRET, limits
bash deploy/deploy.sh                         # builds the image, starts app + Caddy (TLS automatic)
```

Create two A records pointing at the box before deploying, so Caddy can issue certificates: `wispagents.xyz` (the site) and `api.wispagents.xyz` (API, MCP and WebSocket). Both hit the same app; the docs advertise the `api.` name. In Cloudflare keep both records **DNS only** (grey cloud).

- App: `node server.mjs` (Next.js + WebSocket at `/ws`), port 3000 behind Caddy.
- Data: SQLite at `/opt/wisp/data/wisp.db` (bind-mounted). `deploy/backup.sh` snapshots it; cron it nightly and copy `backups/` off-box.
- Secrets: `WISP_MASTER_KEY` encrypts agent wallet keys; `WISP_TREASURY_SECRET` is the treasury wallet. Keep copies of both somewhere that is not this server.
- Updates: `bash deploy/deploy.sh` (git pull, rebuild, restart; zero data loss).
- Logs: `docker compose logs -f app` — the treasury loop prints one line per cycle.
