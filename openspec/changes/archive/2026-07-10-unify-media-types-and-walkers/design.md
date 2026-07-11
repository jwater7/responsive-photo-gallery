# Design — unify media types and directory walking

## Context

Four format lists and three walkers define "what is media" and "what is hidden"
independently (see proposal). The drift is not hypothetical — three live bugs
ship today. Constraints that shape the design:

- The monorepo already has a home for shared primitives (`packages/*`,
  precedent: `rpg-path-safety` from the same review) and a scoped-install
  Docker pattern (enrichment copies only the packages it links).
- Exclude policy is owned by `rpg-config` (`isExcluded`, gallery-side
  `getExcludes` vs enrichment-side fail-open `loadExcludes`), and the two
  services read it differently on purpose — the shared walker must not flatten
  that difference.
- Decoder capability differs by pipeline: ffmpeg handles all four video
  formats; sharp handles gif/tif but HEIF only when the bundled libvips was
  built with it, and BMP not at all (the OCR preprocess already carries a BMP
  note). "Supported extension" and "decodable here" are distinct concepts.
- The 2026-07-10 correctness fixes made enrichment soft-failures safe (recorded
  `<stage>_error`, no output merged, retried on later scans) — expanding format
  coverage no longer risks wiping or freezing docs.

## Goals / Non-Goals

**Goals:**
- One registry for extension sets, type predicates, and the MIME map; one
  excludes-aware walker; all seven current sites consume them.
- Fix the three drift bugs (m4v/webm sprite loss, unindexed heic/gif/avif,
  excludes ignored by `/list`/`/thumbnails`) as consequences of the
  consolidation, not as special cases.
- Make per-plane format support an explicit, spec'd matrix instead of an
  accident of four lists.

**Non-Goals:**
- No new decoders: BMP stays undecodable by sharp (walked, listed, served
  raw — but skipped by sprite/visual/OCR with a recorded reason), and HEIF
  decode support is probed, not added.
- No change to exclude semantics (top-level vs nested behavior, reap policy)
  — only to who honors them.
- No keyframe embeddings / video semantic search (Video #2 owns that).
- No restructuring of the sprite-cache layout beyond the video-thumbs path fix.

## Decisions

1. **New package `packages/media-types` (`rpg-media-types`), not an rpg-config
   extension.** rpg-config is the config store/policy package; media typing is
   a different axis and fast-image-processing must not grow an rpg-config
   dependency. Follows the `rpg-path-safety` precedent (tiny, single-purpose,
   linked by both services + fip, copied in the enrichment Dockerfile).

2. **Canonical sets = today's broadest list (album-build's), single-sourced.**
   IMAGE_EXTS: jpg jpeg png webp gif tif tiff heic heif avif bmp; VIDEO_EXTS:
   mov mp4 m4v webm. Enrichment's narrower image regexp was drift, not policy
   (nothing documents an intentional exclusion). Regexps are DERIVED from the
   sets (`extsToRegexp`) so a format added once is added everywhere.

3. **Walker takes an injected `shouldSkipDir(relPath)` predicate** rather than
   importing rpg-config. Each consumer keeps its own exclude source (gallery:
   in-memory writer view; enrichment: fail-open file read), preserving the
   intentional asymmetry, while the traversal mechanics (dirent walk, dot-entry
   and failed-stat handling, media filtering via the registry) live once.
   Alternative rejected: baking rpg-config in — it would flatten the two read
   models and give fip/other future consumers an unwanted dependency.

4. **image-handler's sync walker goes async.** `/list`/`/thumbnails` handlers
   are already callback-async; the walk call sites move inside the existing
   promise flow. This is the smallest change that lets them share the walker
   AND honor excludes; keeping a second sync walker "for compatibility" would
   re-create the drift this change removes.

5. **Decodability is probed, not listed.** `sharp.format.heif.input` (checked
   once at module load) gates whether visual/OCR/sprite treat HEIC/HEIF as
   decodable in THIS build; BMP is statically undecodable by sharp. The sprite
   build and image-only enrichers skip undecodable-here images with a logged /
   recorded reason (enrichers: soft `error`, so a future image with a
   HEIF-capable sharp heals on re-scan). Geo/caption don't decode pixels
   (exifr / metadata) and take every registry image format unconditionally.
   Alternative rejected: attempt-and-soft-fail with no probe — safe since the
   pipeline fixes, but it re-fails every error-marked doc on every scan and
   pollutes the admin failed-stage stats with thousands of known-impossible
   retries.

6. **Sprite-manifest staleness is handled by an explicit admin action, not an
   auto-rebuild.** Fixing m4v/webm rendering doesn't change album files, so
   cheap fingerprints still match and cached manifests stay stale. Options:
   (a) bake a renderer version into the fingerprint — rebuilds every album on
   deploy (hours of ffmpeg/sharp on a 60k library) for a fix affecting few
   albums; (b) document the existing on-demand full re-hash / cache reap for
   affected albums. Chosen: (b), consistent with the conservative-defaults and
   scans-never-reap conventions; the deploy note lists it.

7. **`/enqueue` validates with `MEDIA_FORMAT_REGEXP`** (registry-derived),
   closing the review's minor-list inconsistency in the same sweep since the
   line is being touched anyway.

## Risks / Trade-offs

- [Excluded files disappearing from `/list`/`/thumbnails` surprises an
  external API consumer] → It's the documented intent of excludes (every other
  plane already hides them); called out as **BREAKING** in the proposal and
  release notes.
- [HEIC indexing on a non-HEIF sharp build yields geo-only docs (pin + date,
  no tags/OCR)] → Correct per the support matrix; the probe keeps visual/OCR
  from generating endless failed retries, and docs gain the missing stages
  automatically if a future image build adds HEIF (stage absent → `isCurrent`
  false → runs).
- [Walker consolidation changes traversal corner cases (dot-entries, symlink
  stat failures) for a consumer that relied on its old walker's quirks] →
  Parity tests per consumer against a fixture tree (dotfiles, broken symlink,
  nested exclude, mixed formats) before the switch; the walker adopts the
  strictest existing behavior (skip dot-entries, tolerate failed stats).
- [Newly indexed formats inflate the first full scan] → One-time cost, on
  demand (full scan is admin-triggered); delta scans only touch new/changed
  files afterwards.
- [Sync→async walk in image-handler subtly changes /list error paths] → The
  new list-params + path-traversal HTTP suites already pin those routes'
  status behavior; extend them with an excluded-subtree fixture.

## Migration Plan

1. Land the package + consumers behind green suites (no data migration).
2. Deploy both images (enrichment Dockerfile gains the package COPY).
3. Run a **full scan** (admin Sync) so newly supported formats are indexed.
4. For albums containing `.m4v`/`.webm` (or gif/heic that should now render):
   trigger the on-demand re-hash / reap the album's cache entry so the sprite
   build re-runs; verify a video cell renders.
5. Rollback = revert images; index docs for new formats are inert extras (reap
   is manual-only), mislocated thumb-cache entries regenerate either way.

## Open Questions

- None blocking. (If the bundled sharp turns out to lack HEIF in the current
  enrichment image, decide later whether upgrading the base image to a
  HEIF-enabled libvips is worth it — the probe makes either answer safe.)
