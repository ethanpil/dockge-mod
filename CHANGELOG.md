# Changelog

This file lists the changes between dockge-mod and the [dockge](https://github.com/louislam/dockge) project.

The base is dockge commit [f809ae1](https://github.com/louislam/dockge/commit/f809ae192b571944ad773e9866d3e67064ae8043). dockge-mod is a drop-in replacement. The database schema, the environment variables, and the socket protocol stay the same. Each new socket event and field only adds data.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project has no releases, so each entry is a commit. The newest entry comes first. A commit that changes only this file or the project rules has no entry.

## [a9a3f0a](../../commit/a9a3f0a) - 2026-08-07

### Changed

- The editors on the stack page use one set of properties, and the dirty test compares the full edit state. A new field in the edit state now gets a dirty mark without a second change.

## [df54017](../../commit/df54017) - 2026-08-07

### Fixed

- A save sends the override file only when the user changes it. Before, each save sent the override, so it could remove a file that a different user or a tool made after the page loaded.
- The editors keep the dirty mark for text that the user writes while a save is in progress. Before, an empty override in that save marked the new text as saved, and the text could go away with no question.
- The reply to a deploy uses the values that went to the server. Before, it read the editor, so it could hide an override file that is on the disk, or show one that is not.
- The Create override button gives back the content of a file that the user deleted in the same session. Before, it put the template in the editor and the content went away.
- Discard leaves edit mode after the stack arrives, so view mode does not show the content that the user discarded.

## [312c5d9](../../commit/312c5d9) - 2026-08-07

### Changed

- The deployStack and the saveStack handlers use one helper for their arguments. The two copies of that block had to stay the same, or one event would accept the old clients and the other would not.

## [d4f1ce9](../../commit/d4f1ce9) - 2026-08-07

### Fixed

- The search for the override file uses the sequence that docker uses. Docker examines four names and uses the first file that it finds, and the name of the base compose file has no effect on that sequence. Before, the interface could hide a file that docker uses, or show a file that docker ignores.
- The save refuses a link or a directory that has the name of the override file. Such a file could look absent in the interface, and then go away in a subsequent save.
- The search for the file name is lazy, so the stack list does not examine the disk for a name that it does not use.

## [5f5a30d](../../commit/5f5a30d) - 2026-08-07

### Security

- Stack.getStack refuses a stack name that goes out of the stacks directory. Before, a name that contains path parts gave a user with an account access to the files of other directories.

## [eb20290](../../commit/eb20290) - 2026-08-06

### Removed

- The dead envTemplate branch on the compose page. Nothing set the value, so the branch never ran.

## [9a8d69c](../../commit/9a8d69c) - 2026-08-06

### Fixed

- The error callback sends the validation type again. ValidationError extends Error, and the Error test came first, so the reply never got the type field.

## [089fa2c](../../commit/089fa2c) - 2026-08-06

### Fixed

- The start, stop, and restart commands for one service get the --env-file options. Before, a stack that uses global.env lost those values in the service commands. A debug print of the compose options also goes away.

## [09b1471](../../commit/09b1471) - 2026-08-06

### Added

- An editor for the compose override file on the stack page. Edit mode shows the editor when the file exists, and a Create override button when it does not. Delete override, or an empty editor, removes the file on the next save.

### Changed

- View mode shows the compose file and the override file side by side, and the logs fill the row below them. Before, the logs and the compose file were side by side. This applies to each stack, also a stack that has no override file.

## [de484b4](../../commit/de484b4) - 2026-08-06

### Added

- Support for the compose override file, for example compose.override.yaml. Docker compose merges the override file with the base file, so changes to a stack from an upstream source survive an update of the base file. The saveStack and deployStack events accept the override content as a new fifth argument. An old client that does not send it keeps the old behavior.

## [b7155bc](../../commit/b7155bc) - 2026-08-06

### Fixed

- The save writes the .env file again. Commit [46ce422](../../commit/46ce422) removed the write, so the editor showed the .env content but a save did not put it on the disk.

## [844328c](../../commit/844328c) - 2026-08-06

### Added

- Save output in the terminal menu. It writes the text of the terminal to a file. A line that the terminal wrapped joins the line above it, and the empty rows below the last output go away.

## [30c66e2](../../commit/30c66e2) - 2026-08-06

### Changed

- Below 1080 pixels the stack list uses smaller rows and a smaller font. More of each stack name stays on screen.

## [5e6ffe6](../../commit/5e6ffe6) - 2026-08-06

### Added

- Select all and Clear in the terminal menu. Select all marks the full buffer, which the selection handler then copies. Clear empties the terminal on this client only.

## [ebe91e7](../../commit/ebe91e7) - 2026-08-06

### Fixed

- Each terminal watches its own box. Before, a terminal fitted itself only when the window changed size. The text went past the right edge of the box after a panel changed width, or after a hidden terminal became visible.

## [4aa67f6](../../commit/4aa67f6) - 2026-08-06

### Fixed

- The icons in the Actions menu have the same width. Before, each icon had its natural width, so the text of each item started at a different position.

## [b86bc28](../../commit/b86bc28) - 2026-08-06

### Changed

- The panel divider is 6 pixels wide, and its buttons use icons. The buttons show when the pointer is on the divider or when a button has the focus. A grip icon marks the divider the rest of the time.

## [6176d4a](../../commit/6176d4a) - 2026-08-06

### Fixed

- The Actions menu opens over the container table. The table scrolls sideways, and the box cut the menu off and made a scrollbar.

## [931ed8b](../../commit/931ed8b) - 2026-08-06

### Fixed

- The long syntax message in the network list uses the language file. A user with a different language saw three translated messages and one English message in the same card.

## [835664f](../../commit/835664f) - 2026-08-06

### Added

- An adjustable width for the logs panel and the compose file panel. Drag the divider between them, or use its three buttons to hide one side or to give both the same width.

### Fixed

- A terminal with no size does nothing. A hidden panel reported almost no rows and columns, and the server gives the pty the smallest size of all clients.

## [d3d0603](../../commit/d3d0603) - 2026-08-06

### Changed

- The container table is narrower. Memory shows the percent on a second line. Network I/O and Block I/O show I and O on their own lines. IP and Ports are one column.

## [5eb5559](../../commit/5eb5559) - 2026-08-06

### Added

- A right click menu with Copy and Paste in each terminal. Copy shows in every mode. Paste shows only where the terminal accepts input.

### Fixed

- Copy and paste on a page that is not https. The browser gives `navigator.clipboard` to an https page or to localhost only. Copy now uses `execCommand` when there is no clipboard object, and Ctrl+V works because the component listens for the paste event.

## [66ade2f](../../commit/66ade2f) - 2026-08-06

### Added

- A Return to Stack button on the container terminal page.

## [0d31582](../../commit/0d31582) - 2026-08-06

### Changed

- The comments follow ASD-STE100 Simplified Technical English. Two comments that stated a wrong rule went away with the code that they described.

## [c2f74c6](../../commit/c2f74c6) - 2026-08-06

### Fixed

- The ports column has links again, so the Primary Hostname setting works. The setting had no reader after the table replaced the cards.
- The memory cell tooltip shows the limit, which is what gives the percent its meaning.
- Between 768 and 1200 pixels the table scrolls sideways. Before, it hid the image, the ports, and both I/O columns, and the cards that hold them start below 768 pixels only.
- One layout renders at a time. The table and the cards both stayed in the page, so every poll patched twice the rows.
- The Add button of a list agrees with the list editor about a blank list item. One shared function now holds the rule.

## [469d19a](../../commit/469d19a) - 2026-08-06

### Fixed

- The terminal reports its size after its name arrives. A size for an empty name went to a terminal that does not exist, and it stopped the correct message.
- Leaving the home page and returning does not add one more host statistics poll each time.
- All disk tiles use the same units, so the total cannot look smaller than one of its parts. Sizes go up to EiB.
- The CPU count shows without a load average.

## [fab024e](../../commit/fab024e) - 2026-08-06

### Fixed

- The IP cache expires after 30 seconds. Docker keeps the container ID through a stop and start cycle. It can also give the container a different address, so an entry cannot stay correct.
- One failure of the host statistics does not stop the dashboard tiles until a restart.
- The pty goes back to the size that the caller set when the last client with a size hint goes away.
- One size change sends one SIGWINCH. Before, the row setter and the column setter each resized the pty.
- The load average shows on an idle host. The test is now the platform, not the value.

## [7fa5109](../../commit/7fa5109) - 2026-08-06

### Fixed

- The unsaved changes dialog stays on screen while the save runs. Before, bootstrap closed the dialog on the click, and the page then refused every navigation with no message for up to 30 seconds.
- A save that answers after the 30 second limit clears the changed mark, because the server has the file.
- A dialog that closes does not remove the backdrop of a different dialog.
- A dialog that opens again during its close animation does not send an answer that the user did not give.

### Changed

- The leave guard waits for the dialog and the save with `await`. Two flags replace four, and a promise accepts one answer only.

## [6488d1c](../../commit/6488d1c) - 2026-08-06

### Changed

- The small outline button is one style in the global sheet. The card labels and the panel headers each had a copy.

## [4492482](../../commit/4492482) - 2026-08-06

### Fixed

- The save records the values that it sent, not the editor buffer at the time of the reply. Keystrokes during a save became the new baseline, and the guard then let the user leave.
- The comparison includes the stack name and the agent. In add mode those are the only work.
- A save stops after 30 seconds. A reply that never comes kept all buttons disabled for ever.
- An answer during a save makes the save reply out of date. A second navigation while the dialog is open no longer replaces the first callback.

### Changed

- The dialog is the shared Confirm component, which gives a focus trap, the Escape key, and the correct dialog role.

## [3974d0a](../../commit/3974d0a) - 2026-08-06

### Fixed

- The "+ Add" buttons show only when the form can edit that field. A click on the button of a map field threw an error. A click on the button of a long syntax list added an item that stayed hidden.
- The open state follows the defaultOpen property until the user makes a choice.
- A long service name does not push the buttons out of the card.

### Changed

- Delete asks for confirmation. Before, it removed a service immediately.
- The toggle reports its state with `aria-expanded`, and the image suggestion list has one identifier for each card.

## [96ca7fa](../../commit/96ca7fa) - 2026-08-06

### Added

- Protection for work that is not saved. The Save button turns green with a dot when changes exist, and a dot shows next to the stack name. Leaving with changes opens a dialog with three choices: stay, discard and leave, or save and leave. A `beforeunload` handler gives the same protection for a tab close.

## [757fc85](../../commit/757fc85) - 2026-08-06

### Changed

- The container editor uses a two-column grid. Image and Restart Policy share a row, Ports and Volumes share a row, and the "+ Add" control moves into the label of each list.
- The card header holds the service name, the image, and the counts of ports, volumes, and environment variables. The Edit button changes to Close when the card is open.

## [4de2879](../../commit/4de2879) - 2026-08-06

### Changed

- The README uses Simplified Technical English. It has no dockge branding, and it gives the install, upgrade, and use instructions for this fork.

## [00444c4](../../commit/00444c4) - 2026-08-06

### Added

- The compose editor marks each YAML syntax error at its position, with a gutter icon and an underline. The message shows when the pointer is on the mark.

## [2f0df6c](../../commit/2f0df6c) - 2026-08-06

### Removed

- CONTRIBUTING.md. This fork does not look for contributions.

## [7649f49](../../commit/7649f49) - 2026-08-06

### Added

- The About page has a link to the dockge-mod project and states the upstream commit that this fork is compatible with.

## [18d0d43](../../commit/18d0d43) - 2026-08-06

### Security

- `npm audit fix` clears the advisories in ws, engine.io, socket.io-parser, brace-expansion, fast-uri, ip-address, and node-pre-gyp. These are lockfile changes within the ranges that the project already permits.
- Open items stay: the sqlite3 install chain needs a major driver change, and lodash has no fixed release. The dockge project has the same items.

## [6c5b158](../../commit/6c5b158) - 2026-08-06

### Security

- path-to-regexp 0.1.12 to 0.1.13 and express 4.21.2 to 4.22.2, from an upstream dependabot branch. This fixes the ReDoS advisory GHSA-37ch-88jc-xwx2 and the body-parser limit bypass GHSA-v422-hmwv-36x6.

## [6f3d520](../../commit/6f3d520) - 2026-08-06

### Security

- yaml 2.3.4 to 2.8.4, from an upstream dependabot branch. This fixes the stack overflow advisory GHSA-48c2-rrv3-qjmp in the library that parses every compose file.

## [fa146d2](../../commit/fa146d2) - 2026-08-05

### Changed

- The frontend build stage pins the build platform. Its output does not depend on the architecture, so a release for three architectures compiled it three times, twice under emulation.

### Removed

- The frontend build on the host in the release scripts. The output is in the dockerignore file, so it could never reach the image.
- The `compare-versions` dependency. Both of the modules that used it are gone.

## [5c80765](../../commit/5c80765) - 2026-08-05

### Fixed

- Restart and Stop stay available for an unhealthy container. The menu offered it only a Start that does nothing.
- The Actions menu shows once for each service. A row for one replica cannot start an action that applies to all replicas.
- Entering edit mode clears the expand overlay.
- A long service name shortens with a tooltip instead of making the column wider than the panel.
- The status dot has a text label, so its state does not come from colour alone.
- Counts use the singular form only for the count 1.

### Removed

- The view mode half of the container card, which nothing could reach, and the DockerStat component, which only that code used.

## [79234b2](../../commit/79234b2) - 2026-08-05

### Fixed

- The memory tile hides when the host does not report MemAvailable. Before, it showed 100 percent used with a red meter.
- The dashboard polls host statistics only on the home page, and its timer starts again after the reply.
- Byte values round correctly at unit boundaries, and IEC sizes such as "1.5GiB" parse correctly.
- The ports column keeps a specific bind address, for example 127.0.0.1, and removes wildcard addresses only.
- Uptime shows a dash when the format of the docker status is not known.

### Changed

- The server holds the host statistics for 60 seconds and serves all clients from one collection. Before, each open tab drove its own walk of the image store and the volume store.
- Container addresses come from one batched `docker inspect` instead of one call for each container.

## [f35c408](../../commit/f35c408) - 2026-08-05

### Added

- Each client reports its terminal size. The server gives the pty the smallest size of all connected clients. Thus a wide client cannot make the text too wide for a narrow client.
- The size hints stay when a terminal closes and opens again with the same name. A stop and start cycle thus keeps the width of the client.

## [62211a3](../../commit/62211a3) - 2026-08-05

### Added

- Stat tiles on the home page. They show stacks by state, containers, host memory with a usage meter, Docker disk with reclaimable space, images, volumes, and the load average.
- The `hostStats` socket event, which supplies the host values. An agent without this event shows the stack tiles only.

## [60a07e8](../../commit/60a07e8) - 2026-08-05

### Changed

- The stack title and the toolbar share one compact row.
- Edit mode uses the same titled panels as view mode.

## [895da1f](../../commit/895da1f) - 2026-08-05

### Changed

- The stack list column is narrow. Each row shows a status dot and a name on one line, and the search box fills the list header.

## [f59c59a](../../commit/f59c59a) - 2026-08-05

### Changed

- The stack page shows the containers in one table instead of one card for each service.
- The logs panel and the compose file panel are side by side and reach the bottom of the window. An expand button opens each panel as a full screen overlay.

## [91ad8af](../../commit/91ad8af) - 2026-08-05

### Changed

- The status "active" is green, not blue.

## [335cdf9](../../commit/335cdf9) - 2026-08-05

### Changed

- The page uses one content column. The inner split is gone.

## [f68e5f6](../../commit/f68e5f6) - 2026-08-05

### Added

- Uptime, IP, and ports for each container. The service status data carries the new fields.

## [928c05f](../../commit/928c05f) - 2026-08-05

### Changed

- The Docker image builds the frontend in its own stage, so `docker build` alone makes a complete image.

## [fa88e22](../../commit/fa88e22) - 2026-08-05

### Removed

- The update checker. The application does not call dockge.kuma.pet, and the update banner is gone.

### Changed

- The name is dockge-mod in the page title, the header, and the About page.

## [05a42be](../../commit/05a42be) - 2026-08-05

### Fixed

- The terminal width follows the browser window. Before, the pty kept a fixed width, so the output wrapped in the middle of a word on a wider window.

## [1f57f08](../../commit/1f57f08) - 2026-08-05

### Fixed

- The inactive badge uses theme tokens that invert with the theme. Before, it was almost black in the light theme and almost invisible in the dark theme.
- The "Containers" heading hides when a stack has no services and the editor is closed.

## [d7ae34d](../../commit/d7ae34d) - 2026-08-05

### Changed

- The project name is dockge-mod.

## [0f7cb95](../../commit/0f7cb95) - 2026-08-05

### Fixed

- The rename dialog starts with the current agent name. To confirm without typing cleared the stored name, which also hid the rename control for ever.
- A dialog releases its bootstrap instance when it unmounts, so instances and dialog elements do not collect as the page remounts.

### Removed

- The theming classes on the body element, which no stylesheet used.

## [c688539](../../commit/c688539) - 2026-08-05

### Fixed

- A dialog hides itself when it unmounts, so its backdrop and its scroll lock cannot outlive it. Before, to go back with a dialog open froze the page behind a backdrop that stayed.
- The edit dialog works on a copy of the agent entry, not on the live object that socket messages replace.
- The status pill has a border, so it stays visible against the dark theme background.

### Changed

- The dracula editor style, the list row style, and the stack list row style each have one rule in the global sheet. Each had two or three copies.

## [a96de9c](../../commit/a96de9c) - 2026-08-05

### Fixed

- Explicit imports for the components that the removed plugin resolved without them.
- The settings menu links use the body colour, not the link blue.

## [3586666](../../commit/3586666) - 2026-08-05

### Changed

- The interface uses standard Bootstrap 5.3 with its own light and dark themes. The custom theme, the custom primary colour, and the gradients are gone.
- The dark theme uses the `data-bs-theme` attribute of Bootstrap. About 250 lines of manual overrides went away.
- Each page is more compact: small toolbars, smaller headings, and less space between the parts.

### Removed

- The `bootstrap-vue-next` and `unplugin-vue-components` dependencies. The dialogs use the raw Bootstrap pattern of this project, and the split button uses the native Bootstrap dropdown.
- The dead CSS from Uptime Kuma and the rules that made buttons, alerts, and dialogs again. The main stylesheet went from 697 lines to about 200.

### Fixed

- The remove agent icon, which was invisible in the light theme.
- The dark input backgrounds in the light theme.
