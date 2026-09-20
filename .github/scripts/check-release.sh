#!/usr/bin/env bash
#
# Ask a public host which release it is actually serving.
#
# A Cloudflare managed challenge sits in front of every public hostname and
# fires *before* the Worker runs, so an ordinary scripted request never reaches
# the app: it gets `403 cf-mitigated: challenge` however healthy the app is, and
# always from a datacenter IP like a runner's. The WAF therefore carries a skip
# rule keyed on a secret header, and OB_PROBE_TOKEN is that header's value.
#
# Without the token this is a no-op rather than a failure, so the pipeline works
# before the rule exists and starts asserting the moment it does.
#
# Usage: check-release.sh <host> [expected-sha]
set -euo pipefail

HOST="${1:?host required}"
EXPECTED="${2:-}"

if [ -z "${OB_PROBE_TOKEN:-}" ]; then
  echo "::notice::OB_PROBE_TOKEN is not set -- skipping the release check for ${HOST}. Add the WAF skip rule and the matching repository secret to turn this into a real assertion."
  exit 0
fi

if ! body="$(curl -sS --max-time 20 -H "x-ob-probe: ${OB_PROBE_TOKEN}" "https://${HOST}/api/health")"; then
  echo "::error::${HOST}: /api/health did not respond"
  exit 1
fi

# The challenge returns an HTML interstitial, not JSON. Catching it explicitly
# gives a useful message instead of a confusing jq parse error.
if printf '%s' "$body" | grep -qiE 'just a moment|<!DOCTYPE html'; then
  echo "::error::${HOST}: still challenged at the edge. Either the WAF skip rule is missing, or OB_PROBE_TOKEN does not match the value the rule expects."
  exit 1
fi

release="$(printf '%s' "$body" | jq -r '.release // empty')"

if [ -z "$release" ]; then
  echo "::error::${HOST}: /api/health returned no release field. Response: ${body}"
  exit 1
fi

if [ -n "$EXPECTED" ] && [ "$release" != "$EXPECTED" ]; then
  echo "::error::${HOST} is serving ${release}, expected ${EXPECTED}. The container may still be rolling, or the roll silently did not take."
  exit 1
fi

echo "${HOST}: serving ${release}"
