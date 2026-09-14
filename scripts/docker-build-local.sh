#!/usr/bin/env bash
# Build the web image locally the same way .github/workflows/docker-image.yml does,
# and optionally push it to the Scaleway container registry.
#
#   ./scripts/docker-build-local.sh              # build only, tag :local
#   ./scripts/docker-build-local.sh --push       # build + push
#   TAG=my-tag ./scripts/docker-build-local.sh   # custom tag
#
# NEXT_PUBLIC_* build args are read from apps/web/.env.local (override by
# exporting them before running). Pushing needs SCW_SECRET_KEY in the env.
set -euo pipefail

REGISTRY="rg.nl-ams.scw.cloud"
NAMESPACE="namespace-distracted-saha"
IMAGE_NAME="openbookings"
PLATFORM="${PLATFORM:-linux/amd64}"   # Scaleway runs amd64; Apple Silicon is arm64

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TAG="${TAG:-local}"
IMAGE="$REGISTRY/$NAMESPACE/$IMAGE_NAME:$TAG"

PUSH=0
[[ "${1:-}" == "--push" ]] && PUSH=1

# ---- Build args ----------------------------------------------------------
BUILD_ARG_NAMES=(
  NEXT_PUBLIC_APP_URL
  NEXT_PUBLIC_COOKIE_VERSION
  NEXT_PUBLIC_MAPTILER_API_KEY
  NEXT_PUBLIC_MAPTILER_STYLE_ID
  NEXT_PUBLIC_POSTHOG_HOST
  NEXT_PUBLIC_POSTHOG_KEY
  NEXT_PUBLIC_SENTRY_DSN
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
)

ENV_FILE="${ENV_FILE:-apps/web/.env.local}"
if [[ -f "$ENV_FILE" ]]; then
  # Load only the NEXT_PUBLIC_* keys we care about; don't clobber values that
  # are already exported in the caller's environment.
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    [[ " ${BUILD_ARG_NAMES[*]} " == *" $key "* ]] || continue
    [[ -n "${!key:-}" ]] && continue
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    export "$key=$val"
  done < "$ENV_FILE"
else
  echo "warning: $ENV_FILE not found; relying on exported build args" >&2
fi

BUILD_ARGS=()
for name in "${BUILD_ARG_NAMES[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "warning: $name is empty — it will be baked into the client bundle as empty" >&2
  fi
  BUILD_ARGS+=(--build-arg "$name=${!name:-}")
done

# ---- Login (push only) ---------------------------------------------------
if [[ $PUSH -eq 1 ]]; then
  if [[ -z "${SCW_SECRET_KEY:-}" ]]; then
    echo "error: SCW_SECRET_KEY must be set to push to $REGISTRY" >&2
    exit 1
  fi
  echo "$SCW_SECRET_KEY" | docker login "$REGISTRY" -u nologin --password-stdin
fi

# ---- Build ---------------------------------------------------------------
echo "==> Building $IMAGE ($PLATFORM)"
docker buildx build \
  --platform "$PLATFORM" \
  --file ./apps/web/Dockerfile \
  --tag "$IMAGE" \
  "${BUILD_ARGS[@]}" \
  $([[ $PUSH -eq 1 ]] && echo --push || echo --load) \
  .

if [[ $PUSH -eq 1 ]]; then
  echo "==> Pushed $IMAGE"
else
  echo "==> Built $IMAGE (not pushed). Run with --push to publish."
  echo "    Local smoke test: docker run --rm -p 8080:8080 --env-file .env.local $IMAGE"
fi
