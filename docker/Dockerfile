############################################
# Healthcheck Binary
############################################
FROM louislam/dockge:build-healthcheck AS build_healthcheck

############################################
# Build
############################################
FROM louislam/dockge:base AS build
WORKDIR /app
COPY --chown=node:node  ./package.json ./package.json
COPY --chown=node:node  ./package-lock.json ./package-lock.json
RUN npm ci --omit=dev

############################################
# Frontend
# Built here so that `docker build` alone produces a working image. Without this
# stage the image starts and then exits on a missing frontend-dist/index.html.
# --platform=$BUILDPLATFORM: the output is arch-independent JS/CSS, so a
# multi-arch build must not recompile it per target under QEMU.
############################################
FROM --platform=$BUILDPLATFORM louislam/dockge:base AS frontend_build
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
FROM louislam/dockge:base AS release
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
