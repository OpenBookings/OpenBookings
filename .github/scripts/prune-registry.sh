#!/usr/bin/env bash
#
# Delete all but the newest few commit-SHA tags of one image in the registry.
#
# Every push to main adds a ~300-700 MB image per rebuilt app and nothing ever
# removed one, so the namespace only grew. Rollback only ever wants a recent
# SHA, so the rest is storage paid for nothing.
#
# What is never deleted:
#   - any tag that is not a 40-character SHA (`main`), since CI did not mint it
#     as a release and something may be pointed at it
#   - the newest $KEEP SHA tags
#   - anything in $PROTECT_TAGS, and the tag the given container is running --
#     a container left on an old image by a rollback must not lose it
#   - any tag sharing a digest with one of the above. The registry deletes by
#     digest, so removing such a tag would take the kept one with it. That is
#     also why `force=true` is never passed.
#
# Usage: prune-registry.sh <image-name> [container-id]
#   SCW_NAMESPACE   registry namespace name (required)
#   KEEP            SHA tags to keep, default 3
#   PROTECT_TAGS    space-separated tag names to keep regardless of age
#   DRY_RUN=true    print what would be deleted, delete nothing
set -euo pipefail

IMAGE_NAME="${1:?image name required}"
CONTAINER_ID="${2:-}"
NAMESPACE="${SCW_NAMESPACE:?SCW_NAMESPACE required}"
KEEP="${KEEP:-3}"
PROTECT_TAGS="${PROTECT_TAGS:-}"
DRY_RUN="${DRY_RUN:-false}"

if ! [[ "$KEEP" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::KEEP must be a positive integer, got '${KEEP}'"
  exit 1
fi

# The image name filter is an exact match but is not scoped to a namespace on
# its own, so resolve the namespace first rather than trust the name alone.
namespace_id="$(scw registry namespace list "name=${NAMESPACE}" -o json | jq -r '.[0].id // empty')"
if [ -z "$namespace_id" ]; then
  echo "::error::registry namespace '${NAMESPACE}' not found"
  exit 1
fi

image_id="$(scw registry image list "namespace-id=${namespace_id}" "name=${IMAGE_NAME}" -o json | jq -r '.[0].id // empty')"
if [ -z "$image_id" ]; then
  echo "${IMAGE_NAME}: no such image in ${NAMESPACE}, nothing to prune"
  exit 0
fi

if [ -n "$CONTAINER_ID" ]; then
  running="$(scw container container get "$CONTAINER_ID" -o json | jq -r '.image // .registry_image // empty')"
  # Only a tag of *this* image is ours to protect; `${running##*:}` on its own
  # would also match a same-named tag of some other image.
  case "$running" in
    */"${IMAGE_NAME}":*) PROTECT_TAGS="${PROTECT_TAGS} ${running##*:}" ;;
  esac
fi

tags="$(scw registry tag list "image-id=${image_id}" order-by=created_at_desc -o json)"

# One line per deletable-by-age tag: id, name, and whether its digest is shared
# with a tag that is being kept.
candidates="$(
  jq -r --argjson keep "$KEEP" --arg protect "$PROTECT_TAGS" '
    def is_sha: test("^[0-9a-f]{40}$");
    ($protect | split(" ") | map(select(length > 0))) as $protected
    | (sort_by(.created_at) | reverse) as $all
    | ([$all[] | select(.name | is_sha)][:$keep] | map(.name)) as $recent
    | [$all[] | select(
        (.name | is_sha | not)
        or (.name as $n | $recent | index($n) != null)
        or (.name as $n | $protected | index($n) != null)
      )] as $kept
    | ($kept | map(.name)) as $kept_names
    | ($kept | map(.digest)) as $kept_digests
    | $all[]
    | select(.name as $n | $kept_names | index($n) == null)
    | [.id, .name, (.digest as $d | $kept_digests | index($d) != null)]
    | @tsv
  ' <<< "$tags"
)"

if [ -z "$candidates" ]; then
  echo "${IMAGE_NAME}: nothing to prune"
  exit 0
fi

failed=0
while IFS=$'\t' read -r tag_id tag_name shared; do
  if [ "$shared" = "true" ]; then
    echo "${IMAGE_NAME}:${tag_name}: same digest as a kept tag, leaving it"
  elif [ "$DRY_RUN" = "true" ]; then
    echo "${IMAGE_NAME}:${tag_name}: would delete"
  elif scw registry tag delete "$tag_id" > /dev/null; then
    echo "${IMAGE_NAME}:${tag_name}: deleted"
  else
    echo "::error::could not delete ${IMAGE_NAME}:${tag_name}"
    failed=1
  fi
done <<< "$candidates"

exit "$failed"
