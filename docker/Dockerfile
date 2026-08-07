############################################
# Base
# The runtime environment: Node.js, the docker CLI, the compose
# plugin, dumb-init, and tsx. Upstream publishes this layer as
# louislam/dockge:base. This file builds it from the source, so the
# image does not depend on the upstream registry.
############################################
FROM node:22-bookworm-slim AS base
RUN apt update && apt install --yes --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    unzip \
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
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g tsx

############################################
# Healthcheck Binary
# Go compiles for the target architecture on the build platform, so
# this stage does not run under emulation.
############################################
FROM --platform=$BUILDPLATFORM golang:1.21-bookworm AS build_healthcheck
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
COPY --chown=node:node  ./package.json ./package.json
COPY --chown=node:node  ./package-lock.json ./package-lock.json
RUN npm ci
COPY --chown=node:node  ./tsconfig.json ./tsconfig.json
COPY --chown=node:node  ./common ./common
COPY --chown=node:node  ./frontend ./frontend
RUN npm run build:frontend

############################################
# ⭐ Main Image
############################################
FROM base AS release
WORKDIR /app
COPY --chown=node:node --from=build_healthcheck /app/extra/healthcheck /app/extra/healthcheck
COPY --from=build /app/node_modules /app/node_modules
COPY --chown=node:node  . .
# After `COPY . .` so the freshly compiled frontend always wins.
COPY --chown=node:node --from=frontend_build /app/frontend-dist /app/frontend-dist
RUN mkdir ./data


# It is just for safe, as by default, it is disabled in the latest Node.js now.
# Read more:
# - https://github.com/sagemathinc/cocalc/issues/6963
# - https://github.com/microsoft/node-pty/issues/630#issuecomment-1987212447
ENV UV_USE_IO_URING=0

VOLUME /app/data
EXPOSE 5001
HEALTHCHECK --interval=60s --timeout=30s --start-period=60s --retries=5 CMD extra/healthcheck
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["tsx", "./backend/index.ts"]

############################################
# Mark as Nightly
############################################
FROM release AS nightly
RUN npm run mark-as-nightly
