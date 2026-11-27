#!/bin/sh
# Starts the console, and the Cloudflare Tunnel in front of it when
# TUNNEL_TOKEN is set. The tunnel's public hostname points at
# http://localhost:8080, so Access sits in front of every request.
#
# Without a token the server just listens on PORT (a local `docker run`).
# With one, the container is only useful while both processes live, so when
# either exits the container exits too and Scaleway restarts it.
set -eu

export HOSTNAME=0.0.0.0
export PORT="${PORT:-8080}"

if [ -z "${TUNNEL_TOKEN:-}" ]; then
  exec bun apps/admin/server.js
fi

cloudflared tunnel --no-autoupdate run --token "$TUNNEL_TOKEN" &
tunnel=$!
bun apps/admin/server.js &
server=$!

# Forward a stop signal to both, so a Scaleway stop is a clean one.
trap 'kill "$tunnel" "$server" 2>/dev/null || true' TERM INT

# Portable (BusyBox ash has no dependable `wait -n`): poll until one is gone.
while kill -0 "$tunnel" 2>/dev/null && kill -0 "$server" 2>/dev/null; do
  sleep 1
done

# Whichever is still running is stopped; the exit status is the one that ended.
if kill -0 "$server" 2>/dev/null; then
  echo "cloudflared exited; stopping the container" >&2
  status=0; wait "$tunnel" || status=$?
else
  echo "the server exited; stopping the container" >&2
  status=0; wait "$server" || status=$?
fi
kill "$tunnel" "$server" 2>/dev/null || true
exit "$status"
