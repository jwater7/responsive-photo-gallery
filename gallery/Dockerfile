# syntax=docker/dockerfile:1
#
# Gallery image. Builds from the REPO ROOT (docker-compose: build.context: .,
# dockerfile: gallery/Dockerfile) — the repo is an npm-workspaces monorepo, so the
# backend stage installs the gallery member with a SCOPED workspace install that
# also links the shared packages (rpg-config, jwt-user-auth, fast-image-processing).
# BuildKit uses the adjacent gallery/Dockerfile.dockerignore. COPY paths are
# relative to the repo root.

##
## Stage 1 — Frontend builder
##
## Export the static Next.js frontend at image-build time so the runtime image
## ships a prebuilt frontend (no Next build, no build toolchain at container
## start). The export is built ONCE with a sentinel base path (/__RPG_BASE__);
## docker-entrypoint.sh rewrites it to the deployment's PUBLIC_URL at container
## start, so one image serves at the domain root or any sub-path while keeping
## PUBLIC_URL a runtime setting. (Next basePath is otherwise build-time only.)
##
FROM node:24-alpine AS frontend-build
WORKDIR /usr/src/app/frontend

COPY gallery/frontend/package.json ./
RUN npm install

COPY gallery/frontend/ ./
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Bake a distinct sentinel for each of the three build-time-frozen base-path
# knobs (Next inlines NEXT_PUBLIC_*/PUBLIC_URL at build, frozen thereafter).
# docker-entrypoint.sh rewrites each from its own runtime env var, preserving the
# app's original independent levers: PUBLIC_URL → Next basePath (asset/router
# URLs); NEXT_PUBLIC_BASENAME → router basename + login cookie path;
# NEXT_PUBLIC_API_PREFIX → API endpoint (may be a different path/origin).
# Sentinels are chosen so none is a substring of another (safe sed order).
ENV PUBLIC_URL=/__RPG_ASSET_BASE__
ENV NEXT_PUBLIC_BASENAME=/__RPG_APP_BASENAME__
ENV NEXT_PUBLIC_API_PREFIX=/__RPG_API_PREFIX__
RUN npm run build

##
## Stage 2 — Backend builder
##
## Install the gallery workspace's node_modules (scoped: gallery + its workspace
## packages only — enrichment is absent from the context, so its deps never land
## here), compiling sharp's native bindings against libvips. The build toolchain
## (vips-dev, fftw-dev, build-base, gyp) lives only in this stage.
##
FROM node:24-alpine AS backend-build
WORKDIR /usr/src/app

RUN apk add --no-cache vips-dev fftw-dev build-base

# Workspace manifests + the shared packages must be present before the scoped
# install resolves them. fast-image-processing is a workspace dep of the gallery,
# so it is compiled here.
COPY package.json ./
COPY gallery/package.json ./gallery/package.json
COPY packages ./packages

RUN apk add --no-cache --virtual .gyp \
        python3 \
        make \
        g++ \
        git \
    && npm install --workspace=gallery \
    && apk del .gyp

##
## Stage 3 — Runtime
##
## No build toolchain — only the runtime native libs (ffmpeg for fluent-ffmpeg,
## libvips for sharp), the gallery app source, the prebuilt backend node_modules +
## packages, and the prebuilt frontend export.
##
FROM node:24-alpine AS runtime
LABEL maintainer="j"
WORKDIR /usr/src/app

# Runtime-only native deps. ffmpeg: fluent-ffmpeg video thumbnails. vips: the
# libvips shared library sharp's native binding links against (the -dev headers
# and build-base stay in the build stage).
RUN apk add --no-cache ffmpeg vips

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Root manifest + gallery app source (node_modules, packages, and frontend/build
# are dockerignored from the context and supplied from the build stages below).
COPY package.json ./
COPY gallery/ ./gallery/
COPY --from=backend-build /usr/src/app/node_modules ./node_modules
COPY --from=backend-build /usr/src/app/packages ./packages
COPY --from=frontend-build /usr/src/app/frontend/build ./gallery/frontend/build

RUN chmod +x gallery/docker-entrypoint.sh

# Run from the gallery member directory; node resolves up to /usr/src/app/node_modules.
WORKDIR /usr/src/app/gallery

EXPOSE 3000

# Rewrite the frontend base path from PUBLIC_URL (see docker-entrypoint.sh), then
# start the server. The frontend is already built — no build step at boot.
ENTRYPOINT ["/usr/src/app/gallery/docker-entrypoint.sh"]
CMD ["npm", "start"]
