# Changelog

This file lists all changes between dockge-mod and the [dockge](https://github.com/louislam/dockge) project.

The base is dockge commit [f809ae1](https://github.com/louislam/dockge/commit/f809ae192b571944ad773e9866d3e67064ae8043). dockge-mod is a drop-in replacement. The database schema, the environment variables, and the socket protocol are the same. All new socket events and fields are additive.

## Interface

- The interface uses standard Bootstrap 5.3 with native light and dark themes. The custom theme is removed.
- The application name is dockge-mod in the page title, the header, and the About page.
- The stack page shows the containers in one table. The columns are service, image, state, uptime, IP, ports, CPU, memory, network I/O, and block I/O.
- Each service has an Actions menu with Bash, Start, Restart, and Stop.
- The Logs panel and the compose.yaml panel are side by side. They extend to the bottom of the window. An expand button opens each panel as a full screen overlay.
- The stack title and the toolbar share one compact row.
- Edit mode uses the same titled panels as view mode.
- The stack list column is narrow. Each row shows a status dot and a truncated name. The search box fills the list header.
- The status "active" is green. The status "inactive" uses a subtle badge that adapts to the theme.
- The home page shows stat tiles: stacks by state, containers, host memory with a usage meter, Docker disk with reclaimable space, images, volumes, and load average.
- Uptime shows in the fixed "0d 0h 55m" form. The ports column hides the wildcard host address.
- On mobile, the table becomes stacked cards at full width. On tablet, the image, ports, and I/O columns hide.

## Features

- The terminal width follows the browser window. Each client reports its size. The server applies the smallest size of all connected clients.
- The additive "hostStats" socket event supplies host memory, load average, and Docker disk usage. An agent without this event shows only the stack tiles.
- The service status data includes uptime, ports, and IP. The IP values come from one batched `docker inspect` call, cached by container ID.
- The compose editor marks each YAML syntax error at its position, with a gutter icon and an underline. The error message shows on hover.

## Fixes

- Restart and Stop stay available for an unhealthy container.
- The Actions menu shows once for each service. A row for one replica cannot start an action that applies to all replicas.
- The terminal keeps the client width after a stack stop and start cycle.
- The ports column keeps a specific bind address, for example 127.0.0.1. Only wildcard addresses are removed.
- Uptime shows a dash when the format of the docker status is not known.
- Byte values round correctly at unit boundaries, and IEC sizes such as "1.5GiB" parse correctly.
- The memory tile hides when the host does not report MemAvailable. Before, it showed 100 percent usage.
- The dashboard polls host stats only on the home page. The server caches the result for 60 seconds and serves all clients from one collection.
- The status dot has a text label for screen readers.
- The Escape key and the backdrop close the expanded panel in all conditions.

## Security

- The update checker is removed. The application does not call dockge.kuma.pet.
- yaml 2.3.4 to 2.8.3 and express 4.21.2 to 4.22.x are applied from the upstream dependabot branches.
- `npm audit fix` clears the advisories in ws, engine.io, socket.io-parser, brace-expansion, fast-uri, and ip-address.
- Known open items: the sqlite3 install chain and lodash. The dockge project has the same items.

## Build

- The Docker image builds the frontend in its own build stage. `docker build` alone makes a complete image.
- The frontend stage builds one time on the build platform. A multi-arch release does not compile it again for each target.
- The release scripts do not build the frontend on the host.
- The `compare-versions` dependency is removed.

## Documentation

- The README uses ASD-STE100 Simplified Technical English.
- The About page links to the dockge-mod repository and to the compatibility commit.
- CONTRIBUTING.md is removed. This project does not accept most pull requests.
- CLAUDE.md gives the project rules.
