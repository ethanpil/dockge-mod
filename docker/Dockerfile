############################################
# Base
# Node.js, the docker CLI with the compose and buildx plugins, git, and
# dumb-init. Upstream publishes this layer as a separate image; building it
# here removes that dependency.
#
# git: stacks that are git checkouts (branch badge, Pull & Redeploy).
# buildx: `docker compose build` for stacks with a build section.
############################################
FROM node:22-bookworm-slim AS base
RUN apt update && apt install --yes --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    unzip \
    git \
    dumb-init \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo \
         "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
         "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
         tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt update \
    && apt --yes --no-install-recommends install \
         docker-ce-cli \
         docker-compose-plugin \
         docker-buildx-plugin \
    && rm -rf /var/lib/apt/lists/*

############################################
# Healthcheck Binary
# Go compiles for the target architecture on the build platform, so
# this stage does not run under emulation.
############################################
FROM --platform=$BUILDPLATFORM golang:1.27-bookworm AS build_healthcheck
WORKDIR /app
ARG TARGETOS
ARG TARGETARCH
ARG TARGETVARIANT
COPY ./extra/healthcheck.go ./extra/healthcheck.go
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH GOARM=${TARGETVARIANT#v} \
    go build -o ./extra/healthcheck ./extra/healthcheck.go

############################################
# Build
############################################
FROM base AS build
WORKDIR /app
COPY --chown=node:node  ./package.json ./package.json
COPY --chown=node:node  ./package-lock.json ./package-lock.json
RUN npm ci --omit=dev

############################################
# Frontend
# Built here so that `docker build` alone produces a working image. Without this
# stage the image starts and then exits on a missing frontend-dist/index.html.
# --platform=$BUILDPLATFORM: the output is arch-independent JS/CSS, so a
# multi-arch build must not recompile it per target under QEMU. This stage only
# needs Node.js, thus it starts from the plain node image.
############################################
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS frontend_build
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
ARG APP_VERSION
COPY --chown=node:node --from=build_healthcheck /app/extra/healthcheck /app/extra/healthcheck
COPY --from=build /app/node_modules /app/node_modules
# Only what the server needs at runtime
COPY --chown=node:node ./package.json ./tsconfig.json ./
COPY --chown=node:node ./backend ./backend
COPY --chown=node:node ./common ./common
COPY --chown=node:node ./extra/reset-password.ts ./extra/reset-password.ts
COPY --chown=node:node --from=frontend_build /app/frontend-dist /app/frontend-dist
RUN if [ -n "$APP_VERSION" ]; then npm pkg set version="$APP_VERSION"; fi
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
