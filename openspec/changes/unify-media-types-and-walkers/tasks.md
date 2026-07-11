# Tasks — unify media types and directory walking

## 1. The rpg-media-types package

- [x] 1.1 Create `packages/media-types` (`rpg-media-types`): IMAGE_EXTS /
      VIDEO_EXTS sets (canonical = album-build's current broadest list),
      `isImage`/`isVideo`/`isMedia`, extension→MIME map + `mimeFor`, and
      `extsToRegexp`-derived SUPPORTED/VIDEO/MEDIA regexps; unit tests for the
      predicates, map, and regexp derivation.
- [x] 1.2 Add the shared excludes-aware async walker to the package:
      dirent-based, skips dot-entries and failed stats, filters by the
      registry, takes `shouldSkipDir(relPath)`; unit tests against a fixture
      tree (dotfiles, broken symlink, nested exclude dir, mixed formats).
- [x] 1.3 Wire the package: root test script `-w packages/media-types`,
      dependency in `gallery/package.json`, `enrichment/package.json`, and
      `packages/fast-image-processing/package.json`; add the COPY line to
      `enrichment/Dockerfile` (gallery's image copies `packages/` wholesale);
      `npm install` to link.

## 2. Registry consumers (format lists)

- [x] 2.1 `packages/fast-image-processing`: replace the local `isVideo`
      (`.mov`/`.mp4` only) with the registry predicate; drop the TODO comment;
      verify `renderCell`/`cacheThumb` dispatch `.m4v`/`.webm` to ffmpeg.
- [x] 2.2 `gallery/handlers/album-build.js`: replace IMAGE_EXTS/VIDEO_EXTS and
      `isMedia` with registry imports.
- [x] 2.3 `enrichment/src/lib/walk-dir.js`: derive SUPPORTED/VIDEO/MEDIA
      regexps from the registry (keep the exported names — geo.js, visual.js,
      ocr.js, caption.js, enrichment-api.js import them).
- [x] 2.4 `enrichment/src/lib/hash.js`: replace MIME_BY_EXT with the
      registry's `mimeFor`.
- [x] 2.5 `gallery/handlers/image-handler.js`: replace the three `.mov`-only
      video-thumb cache-path special cases (image(), thumbnails() single +
      batch) with the registry's `isVideo`; batch copy also switches its raw
      `path.join` to `sanitizeToRoot` (deferred note from review item 12).
- [x] 2.6 `enrichment/src/routes/enrichment-api.js`: `/enqueue` validates with
      MEDIA_FORMAT_REGEXP instead of the image-only pattern.

## 3. Walker consolidation

- [x] 3.1 `gallery/handlers/album-build.js`: replace `walkMedia` with the
      shared walker (exclude predicate from `runtimeConfig`
      getExcludes/isExcluded, preserving the nested-exclude relative-path
      semantics its comment documents).
- [x] 3.2 `enrichment/src/lib/walk-dir.js`: reimplement its walk on the shared
      walker (exclude predicate from rpg-config's fail-open `loadExcludes`),
      keeping the module's public API for its callers.
- [x] 3.3 `gallery/handlers/image-handler.js`: replace the sync `walkDir` with
      the shared walker (now excludes-aware) inside list()/thumbnails(); keep
      handler callback contracts and error codes unchanged.
- [x] 3.4 Walker-parity tests: one fixture tree exercised through all three
      consumers asserting identical inclusion/exclusion (dot-entries, broken
      symlink, nested exclude, every registry format).
- [x] 3.5 Extend `gallery/test/list-params.test.js` (or a sibling) with an
      excluded-subtree fixture: `/list` and `/thumbnails` omit excluded files
      (sibling file `gallery/test/excludes-list.test.js`).

## 4. Capability-aware format support (enrichment + sprite build)

- [x] 4.1 Add a decoder-capability probe (sharp `format` map, checked once at
      module load) exposed for consumers; static: BMP undecodable, HEIF per
      build (`decodableImageExts` in the registry + `enrichment/src/lib/decodable.js`).
- [x] 4.2 Enrichment `applies()` matrix: geo/caption accept all registry image
      formats; visual/OCR accept registry image formats ∩ decodable; skipped-
      for-capability files record a reason (soft error or skip marker per
      design decision 5) and self-heal when a capable build runs; tests for
      both capability outcomes (`enrichment/test/capability-gate.test.js`).
- [x] 4.3 Sprite build (`renderImageCell` path): undecodable-here images are
      skipped with a logged reason (not silently), build completes; test with
      a `.bmp` fixture (`gallery/test/album-build-skip.test.js`).

## 5. Fixtures & end-to-end proof

- [x] 5.1 `gallery/scripts/gen-test-albums.js`: emit an `.m4v` (and `.webm`)
      fixture alongside the existing media (default-on: one clip per registry
      video format; `--no-videos` to skip; warns+skips without ffmpeg).
- [x] 5.2 e2e/unit proof per the album-build-cache delta: an album with all
      four video formats builds cells for each; assert the manifest contains
      the `.m4v`/`.webm` cells with `format: video`
      (`gallery/test/album-build-video.test.js`, real ffmpeg, skips without it).
- [x] 5.3 Full suites green (config 7, path-safety 5, media-types 7, fip 5,
      gallery 63, enrichment 120) + `next build`; live smoke: real server boot
      against a scratch tree — /list & /thumbnails omitted the excluded
      subtree, and the live build gave clip.m4v a `format: video` cell.

## 6. Docs, deploy notes, and archive prep

- [x] 6.1 README/docs: document `rpg-media-types` as the format source of
      truth; note the **BREAKING** excludes behavior of `/list`/`/thumbnails`
      (README "Supported media formats" section).
- [x] 6.2 Deploy notes (change README or TODO): full scan for newly indexed
      formats; forced re-hash / cache reap for albums containing
      `.m4v`/`.webm`; mislocated `.mp4` thumbs self-heal (TODO-DONE.md deploy
      note + design.md migration plan).
- [x] 6.3 Update TODO.md item 13 → TODO-DONE.md (and the `/enqueue` minor-list
      entry) when shipped.
