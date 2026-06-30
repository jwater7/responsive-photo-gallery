# vim: tabstop=2 shiftwidth=2 expandtab
# Self-contained image for the image-enrichment microservice.
#
# Build context is the REPO ROOT (see docker-compose.yml: build.context: .) — the
# repo is an npm-workspaces monorepo, so the image installs the enrichment member
# with a SCOPED workspace install that also links the shared rpg-config package.
# BuildKit uses the adjacent enrichment/Dockerfile.dockerignore (not the root
# .dockerignore) to keep that context minimal. COPY paths are relative to the root.
#
# Debian slim (glibc) rather than Alpine: onnxruntime-node (used by
# transformers.js for local CLIP inference) and sharp ship glibc prebuilts and
# have no musl build.
FROM node:24-slim

WORKDIR /app

# Native OCR engine + English data, and curl/unzip to fetch the offline GeoNames
# dataset below.
#
# OCR preprocessing runs in-process via sharp (libvips), already bundled with the
# npm deps (transformers uses it for CLIP) — so ImageMagick is no longer installed,
# dropping its large Debian codec-CVE surface. To switch back to the legacy
# ImageMagick `convert` backend (e.g. for BMP, which libvips can't decode, or to
# revert a sharp regression), add `imagemagick` to the install list below and set
# OCR_PREPROCESS_USE_MAGICK=true on the service.
#
# ffmpeg provides ffprobe, which the geo enricher uses to read a video's embedded
# location + capture date (the QuickTime metadata atoms exifr can't reach). It is
# also forward-compatible groundwork for later frame-based video enrichment
# (keyframe CLIP/OCR). NOTE: the API and worker containers share this image, so
# ffmpeg lands in both and adds to the Debian CVE surface (see Security TODO) —
# accepted because the enrichment plane is internal-only. Debian ships ffprobe
# only inside the ffmpeg package, so there is no slimmer option.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-eng ffmpeg curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bundle the higher-accuracy tessdata_best LSTM model for English (build-time
# download, offline at runtime — same approach as the GeoNames dumps below). The
# default fast `tesseract-ocr-eng` package above stays the default; set
# OCR_TESSDATA_PREFIX=/data/tessdata-best to opt into this slower, more accurate
# data once profiling justifies the extra scan time.
RUN mkdir -p /data/tessdata-best \
    && curl -fsSL https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata \
         -o /data/tessdata-best/eng.traineddata

# Bundle the GeoNames dumps for offline reverse geocoding (build-time download;
# zero network at runtime). cities15000 is ~25k cities worldwide (~5MB).
RUN mkdir -p /data/geonames && cd /data/geonames \
    && curl -fsSL https://download.geonames.org/export/dump/cities15000.zip -o cities.zip \
    && unzip -o cities.zip && rm cities.zip \
    && curl -fsSL https://download.geonames.org/export/dump/admin1CodesASCII.txt -o admin1CodesASCII.txt \
    && curl -fsSL https://download.geonames.org/export/dump/countryInfo.txt -o countryInfo.txt

# Scoped workspace install. The root manifest + the enrichment manifest + the
# rpg-config package are enough for `--workspace=enrichment` to resolve and install
# ONLY the enrichment dependency closure (enrichment deps + rpg-config) — gallery
# and the other packages are absent from the context and npm tolerates that, so the
# image stays lean. rpg-config is linked into /app/node_modules with its real path
# under /app, so its hoisted deps resolve with no per-image workaround.
COPY package.json ./
COPY packages/config ./packages/config
COPY enrichment/package*.json ./enrichment/
RUN npm install --omit=dev --workspace=enrichment && npm cache clean --force

# Bake the local CLIP weights into the image at build time (like the GeoNames
# dumps above) so the running service makes zero outbound calls. The model is
# fetched once here into MODEL_CACHE_PATH; do NOT mount a volume over this path
# at runtime or the baked weights are shadowed. Overriding EMBED_MODEL at
# runtime would re-introduce a one-time download.
#
# Copy only the files the prefetch needs (the embedder + its config) BEFORE the
# full source, so routine source edits don't invalidate this ~150MB layer.
ENV DEBUG=responsive-photo-gallery:* \
    MODEL_CACHE_PATH=/data/models
COPY enrichment/src/lib/config.js enrichment/src/lib/embedder.js ./enrichment/src/lib/
COPY enrichment/src/bin/prefetch-model.js ./enrichment/src/bin/
RUN mkdir -p /data/models && node enrichment/src/bin/prefetch-model.js

# Copy the rest of the source (and the eval harness fixtures).
COPY enrichment/src/ ./enrichment/src/
COPY enrichment/eval/ ./enrichment/eval/

# Run from the enrichment member directory; node resolves up to /app/node_modules.
WORKDIR /app/enrichment

EXPOSE 8080

CMD ["node", "src/bin/server.js"]
