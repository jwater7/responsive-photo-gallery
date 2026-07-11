# Unify media types and directory walking

## Why

"What counts as a photo/video" and "what is hidden" are currently defined in four
independent format lists and three independent directory walkers across the
gallery, the enrichment service, and fast-image-processing — and they have
drifted into three live, user-visible bugs: `.m4v`/`.webm` files silently vanish
from album sprites (misdispatched to sharp, which fails), `.gif`/`.heic`/`.avif`
photos appear in albums but are never enriched (absent from search and the map),
and the admin exclude list is ignored by the `/list`/`/thumbnails` walker so
excluded subtrees remain reachable there while every other plane hides them.
Every future format or exclude fix currently has to be found and applied up to
four times. (Code-review 2026-07-10, item 13.)

## What Changes

- New in-tree package `packages/media-types` (`rpg-media-types`): the single
  source for image/video extension sets, `isImage()`/`isVideo()`/`isMedia()`,
  the extension→MIME map, and regexps derived from the same sets — plus one
  shared excludes-aware async directory walker (exclude policy injected as a
  predicate, so the package has no hard `rpg-config` dependency).
- All four format-list copies consume the registry: `album-build.js`
  IMAGE_EXTS/VIDEO_EXTS, enrichment `walk-dir.js` regexps,
  `fast-image-processing` `isVideo`, enrichment `hash.js` MIME map.
- All three walkers consolidate onto the shared walker: image-handler's sync
  walker (which today ignores excludes), album-build's `walkMedia`, and
  enrichment's `walk-dir`.
- Bug fixes that fall out:
  - `.m4v`/`.webm` render as video cells in sprite builds and video thumbnails
    (ffmpeg path) instead of failing through sharp and being skipped.
  - `/list` and `/thumbnails` honor admin excludes like every other plane.
  - The `.mov`-only video-thumb cache-path special case in image-handler uses
    the shared `isVideo` (`.mp4`/`.m4v`/`.webm` thumbs land under
    `video-thumbs/`; old mislocated cache entries are orphaned and regenerate).
  - Enrichment `/enqueue` validates against the full media regexp instead of
    the image-only one, matching what the pipeline actually supports
    (code-review minor-list item).
- Format-coverage expansion, decided explicitly per plane (the support matrix
  lives in the new spec): geo/caption enrichment opts in to `.heic`/`.heif`
  (exifr reads HEIC EXIF) and the other album-visible image formats; visual/OCR
  attempt them and rely on the pipeline's soft-fail semantics (record
  `<stage>_error`, retry on a later scan — hardened in the 2026-07-10
  correctness fixes) where the bundled sharp build can't decode a format.
- **BREAKING** (behavioral, intended): files under an admin-excluded subtree no
  longer appear in `/list`/`/thumbnails` responses.

## Capabilities

### New Capabilities
- `media-discovery`: the shared media-type registry (extension sets, type
  predicates, MIME map, per-plane format support matrix) and the shared
  excludes-aware directory walker every media-enumerating plane uses.

### Modified Capabilities
- `album-build-cache`: the build pass's inclusion requirement changes — every
  registry-supported media format SHALL be rendered by its correct pipeline
  (sharp for images, ffmpeg for videos); a supported file must never be
  silently dropped because of type misdispatch.

## Impact

- **New:** `packages/media-types` (+ unit tests), wired into both services'
  `package.json`, the enrichment Dockerfile package COPY block, and the root
  test script (gallery's image already copies `packages/` wholesale).
- **Gallery:** `handlers/album-build.js` (format sets + `walkMedia`),
  `handlers/image-handler.js` (sync walker, `.mov` special cases at the three
  thumb-path sites), `routes/api.js` untouched at the surface (behavior of
  `/list`/`/thumbnails` changes per excludes).
- **Enrichment:** `src/lib/walk-dir.js` (regexps + walker),
  `src/lib/hash.js` (MIME map), `src/routes/enrichment-api.js` (`/enqueue`
  regexp), scan coverage grows for newly supported formats.
- **fast-image-processing:** `isVideo` delegates to the registry.
- **Data/deploy:** a full scan is required for newly indexed formats to appear
  in search/map; albums containing `.m4v`/`.webm` need a forced manifest
  rebuild (their cheap fingerprint does not change when rendering is fixed);
  mislocated `.mp4` thumb-cache entries self-heal on demand.
- **Tests:** registry + walker unit tests; walker-parity coverage for excludes;
  an `.m4v` fixture in `gen-test-albums` proving the sprite build renders it;
  existing suites (gallery 56, enrichment 115) must stay green.
