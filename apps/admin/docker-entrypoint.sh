#!/bin/sh
# Starts the Cloudflare Tunnel (when TUNNEL_TOKEN is set), then the console.
# The tunnel's public hostname points at http://localhost:8080, so Access sits
# in front of every request; without a token the server just listens on PORT,
# which is how a local `docker run` is tested.
set -eu

if [ -n "${TUNNEL_TOKEN:-}" ]; then
  cloudflared tunnel --no-autoupdate run --token "$TUNNEL_TOKEN" &
fi

HOSTNAME=0.0.0.0 PORT="${PORT:-8080}" exec bun apps/admin/server.js
