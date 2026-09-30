############################################
# Docker CLI
# The docker CLI and the compose and buildx plugins, as static binaries
# from Docker's official image. This avoids Docker's apt repository and
# the curl, gnupg, and unzip packages that it needed. A rebuild picks up
# the latest 29.x release.
#
# buildx: `docker compose build` for stacks with a build section.
############################################
FROM docker:29-cli AS docker_cli

############################################
# Base
# Node.js on Debian 13, with git and dumb-init. The upgrade applies the
# Debian security updates that are newer than the Node.js image.
#
# git: stacks that are git checkouts (branch badge, Pull & Redeploy).
############################################
# Node.js publishes Debian 13 images for amd64 and arm64 only. armv7 stays
# on Debian 12, with its security updates applied by the upgrade below.
# BuildKit builds only the stage of the target platform.
FROM node:22-trixie-slim AS node-amd64
FROM node:22-trixie-slim AS node-arm64
FROM node:22-bookworm-slim AS node-arm
FROM node-${TARGETARCH} AS base
RUN apt-get update \
    && apt-get upgrade --yes \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        git \
        dumb-init \
    && rm -rf /var/lib/apt/lists/*
COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker_cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins

############################################
# Healthcheck Binary
# Go compiles for the target architecture on the build platform, so
# this stage does not run under emulation.
############################################
FROM --platform=$BUILDPLATFORM golang:1.27-trixie AS build_healthcheck
WORKDIR /app
ARG TARGETOS
ARG TARGETARCH
ARG TARGETVARIANT
COPY ./extra/healthcheck.go ./extra/healthcheck.go
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH GOARM=${TARGETVARIANT#v} \
    go build -trimpath -ldflags="-s -w" -o ./extra/healthcheck ./extra/healthcheck.go

############################################
# Build
############################################
FROM base AS build
WORKDIR /app
ARG APP_VERSION
COPY --chown=node:node  ./package.json ./package.json
COPY --chown=node:node  ./package-lock.json ./package-lock.json
RUN npm ci --omit=dev
# The sqlite3 driver uses node-gyp, tar, and their helpers only to install
# itself. At runtime its loader calls node-pre-gyp's find(), which does not
# load them, so they leave the image. The require checks that the native
# modules still load.
RUN find ./node_modules -depth -type d \( \
        -path "*/node_modules/node-gyp" -o -path "*/node_modules/tar" \
        -o -path "*/node_modules/cacache" -o -path "*/node_modules/make-fetch-happen" \
        -o -path "*/node_modules/http-proxy-agent" -o -path "*/node_modules/@tootallnate/once" \
    \) -exec rm -rf {} + \
    && node -e "require('@louislam/sqlite3'); require('@homebridge/node-pty-prebuilt-multiarch')"
# The release stage has no npm, so the version is set here
RUN if [ -n "$APP_VERSION" ]; then npm pkg set version="$APP_VERSION"; fi

############################################
# Frontend
# Built here so that `docker build` alone produces a working image. Without this
# stage the image starts and then exits on a missing frontend-dist/index.html.
# --platform=$BUILDPLATFORM: the output is arch-independent JS/CSS, so a
# multi-arch build must not recompile it per target under QEMU. This stage only
# needs Node.js, thus it starts from the plain node image.
############################################
FROM --platform=$BUILDPLATFORM node:22-trixie-slim AS frontend_build
WORKDIR /app
ARG APP_VERSION
COPY --chown=node:node  ./package.json ./package.json
COPY --chown=node:node  ./package-lock.json ./package-lock.json
RUN npm ci
# The interface shows this version, and it must agree with the backend
RUN if [ -n "$APP_VERSION" ]; then npm pkg set version="$APP_VERSION"; fi
COPY --chown=node:node  ./tsconfig.json ./tsconfig.json
COPY --chown=node:node  ./common ./common
COPY --chown=node:node  ./frontend ./frontend
RUN npm run build:frontend

############################################
# ⭐ Main Image
############################################
FROM base AS release
WORKDIR /app
# The server never runs npm. Removing it, and corepack, removes their
# bundled dependencies from the image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --chown=node:node --from=build_healthcheck /app/extra/healthcheck /app/extra/healthcheck
COPY --from=build /app/node_modules /app/node_modules
# Only what the server needs at runtime. package.json comes from the build
# stage, which holds the version of the image.
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node ./tsconfig.json ./
COPY --chown=node:node ./backend ./backend
COPY --chown=node:node ./common ./common
COPY --chown=node:node ./extra/reset-password.ts ./extra/reset-password.ts
COPY --chown=node:node --from=frontend_build /app/frontend-dist /app/frontend-dist
# Dockge has tsx on the PATH. Keep that for compose files and commands that
# call it, pointing at the version of the lock file.
RUN mkdir ./data && ln -s /app/node_modules/.bin/tsx /usr/local/bin/tsx


# It is just for safe, as by default, it is disabled in the latest Node.js now.
# Read more:
# - https://github.com/sagemathinc/cocalc/issues/6963
# - https://github.com/microsoft/node-pty/issues/630#issuecomment-1987212447
ENV UV_USE_IO_URING=0

VOLUME /app/data
EXPOSE 5001
HEALTHCHECK --interval=60s --timeout=30s --start-period=60s --retries=5 CMD extra/healthcheck
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
# The tsx of the lock file, not a global install
CMD ["/app/node_modules/.bin/tsx", "./backend/index.ts"]
