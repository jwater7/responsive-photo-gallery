#!/bin/sh
# vim: tabstop=2 shiftwidth=2 expandtab
#
# Runtime base-path rewrite.
#
# The Next.js static frontend is exported ONCE at image-build time. Next inlines
# NEXT_PUBLIC_*/PUBLIC_URL into the bundle at build and FREEZES them there (per
# the Next docs); with output:'export' there is no server to read them at runtime.
# To keep them runtime-configurable in a single prebuilt image we bake a distinct
# sentinel for each of the app's three independent base-path knobs and rewrite
# each here, at container start, from its own env var. This is a text substitution
# over prebuilt files — not a frontend build, and no build toolchain is required.
#
#   PUBLIC_URL              -> Next basePath: asset + router URLs   (must be a path)
#   NEXT_PUBLIC_BASENAME    -> router basename + login cookie path  (default: PUBLIC_URL)
#   NEXT_PUBLIC_API_PREFIX  -> API endpoint prefix; may be a different path/origin
#                             (default: NEXT_PUBLIC_BASENAME, then PUBLIC_URL)
#
# Verified the three sentinels bake intact on this project's Next 16 + Turbopack
# export. The fallback chain mirrors frontend/lib/api.js so setting only
# PUBLIC_URL keeps the common single-knob behaviour.
set -e

BUILD_DIR='/usr/src/app/gallery/frontend/build'
MARKER="$BUILD_DIR/.rpg-basepath-applied"

# Normalize a base-path value: unset/"/" -> "" (domain root); strip one trailing
# slash. e.g. "/photos/" -> "/photos", "/" -> "", "https://api.x/" -> "https://api.x".
norm() {
  p="${1:-/}"
  p="${p%/}"
  printf '%s' "$p"
}

ASSET_BASE=$(norm "${PUBLIC_URL:-/}")
APP_BASENAME=$(norm "${NEXT_PUBLIC_BASENAME:-${PUBLIC_URL:-/}}")
API_PREFIX=$(norm "${NEXT_PUBLIC_API_PREFIX:-${NEXT_PUBLIC_BASENAME:-${PUBLIC_URL:-/}}}")

# Replace a sentinel with its resolved value across every file that contains it.
# '#' delimiter so path/URL '/' chars need no escaping.
rewrite_one() {
  _sentinel="$1"
  _value="$2"
  grep -rl "$_sentinel" "$BUILD_DIR" 2>/dev/null | while IFS= read -r f; do
    sed -i "s#${_sentinel}#${_value}#g" "$f"
  done
}

if [ -d "$BUILD_DIR" ]; then
  # The PUBLIC_URL sentinel is always baked (PUBLIC_URL is always set at build),
  # so its presence reliably means "not yet rewritten" (fresh container, since a
  # recreate resets the writable layer to the image).
  if grep -rq '/__RPG_ASSET_BASE__' "$BUILD_DIR" 2>/dev/null; then
    echo "rpg: applying base paths — assets='${ASSET_BASE:-(root)}'" \
         "basename='${APP_BASENAME:-(root)}' api='${API_PREFIX:-(root)}'"
    rewrite_one '/__RPG_ASSET_BASE__'   "$ASSET_BASE"
    rewrite_one '/__RPG_APP_BASENAME__' "$APP_BASENAME"
    rewrite_one '/__RPG_API_PREFIX__'   "$API_PREFIX"
    : > "$MARKER" 2>/dev/null || true
  elif [ -f "$MARKER" ]; then
    # Sentinels gone but we applied them before: a plain restart, nothing to do.
    echo "rpg: base paths already applied (restart) — assets='${ASSET_BASE:-(root)}'"
  else
    # Fresh container with no sentinels and no marker: the export stopped baking
    # the sentinels (e.g. a Next upgrade). Warn loudly — asset paths may be wrong.
    echo "rpg: WARNING no base-path sentinels found in $BUILD_DIR on a fresh" \
         "container. The frontend export no longer bakes them, so PUBLIC_URL/" \
         "NEXT_PUBLIC_* will NOT be applied and asset paths may be broken."
  fi
fi

exec "$@"
