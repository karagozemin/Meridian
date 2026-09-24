#!/bin/sh
# Panel, sampler, and the onchainos session. The session is not in the image.
set -eu

export PATH="/usr/local/bin:/root/.local/bin:${PATH}"
if ! command -v onchainos >/dev/null 2>&1; then
  echo "onchainos is not on PATH. USDG/USD, quotes, and the index will be withheld." >&2
fi

mkdir -p /data/onchainos /data/series /app/data

if [ -n "${ONCHAINOS_BUNDLE:-}" ] && [ ! -f /data/onchainos/session.json ]; then
  printf '%s' "$ONCHAINOS_BUNDLE" | base64 -d | tar -xz -C /data/onchainos
fi

if [ ! -s /data/series/samples.jsonl ] && [ -f /app/data/snapshot.jsonl ]; then
  cp /app/data/snapshot.jsonl /data/series/samples.jsonl
fi

ln -sfn /data/series/samples.jsonl /app/data/samples.jsonl
rm -rf /root/.onchainos
ln -s /data/onchainos /root/.onchainos

node dist/cli/sampler.js --interval 300 &
exec node dist/server/panel-server.js
