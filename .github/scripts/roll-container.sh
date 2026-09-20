#!/usr/bin/env bash
#
# Point one Scaleway Serverless Container at an image tag and wait for it.
#
# Scaleway has no traffic-splitting primitive -- not in `container update`, not
# in `container deploy`, not in the Terraform provider, not in Edge Services --
# so "deploy" here is exactly: set the image, trigger a deploy, wait for
# `ready`. Scaleway does ramp old to new during that window, but it always ends
# at 100% and is not controllable. Anything finer-grained has to happen above
# Scaleway, in the reverse-proxy Worker.
#
# Shared by ci.yml (release) and rollback.yml, which differ only in which SHA
# they point at -- every SHA is an immutable tag, so a rollback needs no build.
#
# Usage: roll-container.sh <container-id> <image>
set -euo pipefail

CONTAINER_ID="${1:?container id required}"
IMAGE="${2:?image required}"

# A cold Next.js container takes tens of seconds; ten minutes is generous
# enough that hitting it means something is actually wrong.
TIMEOUT_SECONDS="${ROLL_TIMEOUT_SECONDS:-600}"
POLL_SECONDS="${ROLL_POLL_SECONDS:-10}"
# How long to wait for the deploy to visibly start before assuming it was a
# no-op. See the two-phase wait below.
START_TIMEOUT_SECONDS="${ROLL_START_TIMEOUT_SECONDS:-60}"

container_status() {
  scw container container get "$CONTAINER_ID" -o json | jq -r '.status'
}

echo "Rolling ${CONTAINER_ID} to ${IMAGE}"

# `image=`, not `registry-image=`, and `redeploy`, not `deploy` -- the CLI has
# no `deploy` subcommand at all. Both were wrong here and each only surfaced
# once the call before it succeeded. Verified against scw 2.62.0:
#   scw container container update --help   -> [image]
#   scw container container --help          -> create|delete|get|list|redeploy|update
scw container container update "$CONTAINER_ID" "image=${IMAGE}" -o json > /dev/null

# Changing the image is itself enough to start a deployment, so this can come
# back "already deploying". That is the good case, not a failure, and the
# two-phase wait below is what actually decides whether the roll worked -- so
# only this one call tolerates an error, and says when it hit one.
if ! redeploy_err="$(scw container container redeploy "$CONTAINER_ID" -o json 2>&1 >/dev/null)"; then
  echo "  redeploy call returned an error; relying on the update-triggered deployment"
  echo "  (${redeploy_err})"
fi

# Phase one: wait for the container to leave `ready`.
#
# Without this the poll below can observe the *previous* deployment's `ready`
# and declare success while the old image is still serving -- the status does
# not flip to pending instantly. If it never leaves `ready`, the deploy was a
# no-op (same image as before), which is not an error.
started=false
deadline=$(( SECONDS + START_TIMEOUT_SECONDS ))
while (( SECONDS < deadline )); do
  if [ "$(container_status)" != "ready" ]; then
    started=true
    break
  fi
  sleep 2
done

if [ "$started" = false ]; then
  echo "  never left 'ready' in ${START_TIMEOUT_SECONDS}s -- already on this image"
  exit 0
fi

# Phase two: wait for it to come back.
deadline=$(( SECONDS + TIMEOUT_SECONDS ))
while true; do
  status="$(container_status)"
  case "$status" in
    ready)
      echo "  ready"
      exit 0
      ;;
    error)
      echo "::error::${CONTAINER_ID} entered status 'error'"
      scw container container get "$CONTAINER_ID" -o json | jq -r '.error_message // "(no error message)"'
      exit 1
      ;;
    *)
      if (( SECONDS >= deadline )); then
        echo "::error::${CONTAINER_ID} still '${status}' after ${TIMEOUT_SECONDS}s"
        exit 1
      fi
      echo "  ${status}..."
      sleep "$POLL_SECONDS"
      ;;
  esac
done
