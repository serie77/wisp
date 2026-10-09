#!/usr/bin/env bash
# Nightly SQLite snapshot (add to cron: 0 3 * * * /opt/wisp/deploy/backup.sh). Copy backups/ off the box.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
docker compose exec -T app node -e '
const { createClient } = require("@libsql/client");
createClient({ url: "file:/app/data/wisp.db" }).execute("VACUUM INTO \x27/app/data/backup.db\x27").then(() => console.log("snapshot ok"));'
mv data/backup.db "backups/wisp-$(date +%F).db"
ls -1 backups | sort | head -n -14 | xargs -r -I{} rm backups/{}
