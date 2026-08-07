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
- Below 768 pixels the table becomes stacked cards at full width. Between 768 and 1200 pixels the table scrolls sideways, so no column goes out of reach. Only one of the two layouts renders.

## Features

- The terminal width follows the browser window. Each client reports its size. The server applies the smallest size of all connected clients.
- The additive "hostStats" socket event supplies host memory, load average, and Docker disk usage. An agent without this event shows only the stack tiles.
- The service status data includes uptime, ports, and IP. The IP values come from one batched `docker inspect` call, held for 30 seconds.
- The compose editor marks each YAML syntax error at its position, with a gutter icon and an underline. The error message shows on hover.
- The container editor uses a two-column grid. The card header shows the name, the image, and the item counts. The Edit button changes to Close when the card is open. Cards start closed when a stack has three or more services.
- The Save button becomes green when there are changes to save. A dot also shows next to the stack name.
- A dialog shows when you leave with changes that are not saved. The dialog gives three choices: stay, discard and leave, or save and leave. The dialog shows only when changes exist. A browser prompt gives the same protection if you close the tab.

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

### Interface polish, August 2026

- Each terminal now watches its own box. Before, a terminal fitted itself only when the window changed size, so text went past the right edge after a panel changed width or became visible. ([ebe91e7](../../commit/ebe91e7))
- The panel divider is 6 pixels wide. Its buttons use icons and appear when the pointer is on the divider. A grip icon marks it the rest of the time. ([b86bc28](../../commit/b86bc28))
- The terminal menu also has Select all, Save output, and Clear. Save output writes the text of the terminal to a file. ([5e6ffe6](../../commit/5e6ffe6), [844328c](../../commit/844328c))
- The icons in the Actions menu have the same width, so the text of each item starts at the same position. ([4aa67f6](../../commit/4aa67f6))
- Below 1080 pixels the stack list uses smaller rows. ([30c66e2](../../commit/30c66e2))

### Interface work, August 2026

- The logs panel and the compose file panel have an adjustable width. Drag the divider, or use its three buttons to hide one side or to give both the same width. ([835664f](../../commit/835664f))
- A right click in any terminal opens a menu with Copy and Paste. Ctrl+V now works on a page that is not https, where the browser gives no clipboard object. ([5eb5559](../../commit/5eb5559))
- The container terminal page has a Return to Stack button. ([66ade2f](../../commit/66ade2f))
- The container table is narrower. Memory shows the percent on a second line, Network I/O and Block I/O show I and O on their own lines, and IP and Ports are one column. ([d3d0603](../../commit/d3d0603))
- The Actions menu opens over the table. The table scrolls sideways, and the menu was cut off before. ([6176d4a](../../commit/6176d4a))
- The long syntax message in the network list is translated. ([931ed8b](../../commit/931ed8b))

### Code review, August 2026

- The unsaved-changes dialog no longer stops navigation with no message. The dialog stays on screen while the save runs. ([7fa5109](../../commit/7fa5109))
- A save that answers after the 30 second limit now clears the changed mark. ([7fa5109](../../commit/7fa5109))
- The IP cache no longer keeps an empty address after a stack stop and start cycle. ([fab024e](../../commit/fab024e))
- One failure of the host statistics no longer stops the dashboard tiles until a restart. ([fab024e](../../commit/fab024e))
- The pty goes back to its default size when the last client with a size goes away. One size change now sends one SIGWINCH. ([fab024e](../../commit/fab024e))
- The load average shows on an idle host. Windows shows the CPU count without a load average. ([fab024e](../../commit/fab024e), [469d19a](../../commit/469d19a))
- The terminal reports its size after the name arrives, not before. ([469d19a](../../commit/469d19a))
- Leaving the home page and returning no longer adds one more host statistics poll each time. ([469d19a](../../commit/469d19a))
- All disk tiles use the same units, so the total cannot look smaller than one of its parts. Sizes go up to EiB. ([469d19a](../../commit/469d19a))
- The ports column has links again, so the Primary Hostname setting works. ([c2f74c6](../../commit/c2f74c6))
- The memory cell tooltip shows the limit. ([c2f74c6](../../commit/c2f74c6))
- The Add button of a list agrees with the list editor about a blank list item. ([c2f74c6](../../commit/c2f74c6))
- A dialog that closes no longer removes the backdrop of a different dialog. ([7fa5109](../../commit/7fa5109))

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
