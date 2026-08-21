# Changelog

This file lists the changes between dockge-mod and the [dockge](https://github.com/louislam/dockge) project.

The base is dockge commit [f809ae1](https://github.com/louislam/dockge/commit/f809ae192b571944ad773e9866d3e67064ae8043). dockge-mod is a drop-in replacement. The tables of Dockge, the environment variables, and the socket protocol stay the same. dockge-mod adds only tables with the `mod_` prefix, with their own migration ledger. Each new socket event and field only adds data.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project has no releases, so each entry is a commit. The newest entry comes first. A commit that changes only this file or the project rules has no entry.

## [9acb9fd](../../commit/9acb9fd) - 2026-08-21

### Fixed

- A mod migration ledger row without a file is a warning, the same as in the upstream patch. An older image of dockge-mod starts again after a newer one.
- A problem with the legacy template file does not stop the server.
- The write of a mod setting is one upsert statement, thus two saves at the same time cannot fail on the unique key.

## [bced752](../../commit/bced752) - 2026-08-21

### Added

- A migration ledger for the tables of dockge-mod. The tables have the `mod_` prefix and their own ledger table, `mod_knex_migrations`. The upstream `knex_migrations` table does not change, thus Dockge can run its own migrations after a user goes back to it.

### Changed

- The override template is in the `mod_setting` table, not in a file of the data directory. The start of the server moves the content of an existing `compose.override.template.yaml` to the table and removes the file.

## [37b8c7a](../../commit/37b8c7a) - 2026-08-21

### Changed

- The pure format helpers and the `.env` parser are in the `common` directory, thus the tests and the type check cover them. The pages keep their import paths.

## [7cdc795](../../commit/7cdc795) - 2026-08-21

### Added

- A test harness with vitest. `npm test` runs the tests, and the CI job runs them after the type check. The tests examine the port parser, the env substitution, the status names, the compose argument sequence, the stack name checks, and the `.env` row parser. These tests protect the compatibility with Dockge.

## [3571439](../../commit/3571439) - 2026-08-07

### Fixed

- The answer of a pull keeps the toolbar closed until the new stack content arrives. A late answer does not load the stack over an open edit session, and not for a page that went away.
- The pull timer and the health answer are quiet after the page goes away. A toast could show on a different page minutes later before.
- A watcher on the expanded panel ends a merged configuration request. The unmount makes a late answer stale.
- A key of an env variable can start with a number, the same as docker accepts.
- The safe git directory is the physical path, with forward slashes on Windows. A symbolic link in the stacks path made the exception empty.
- The changelog file has no byte order mark.

## [60b035b](../../commit/60b035b) - 2026-08-07

### Fixed

- Git accepts a stack directory that a different user owns. The server runs as root in the container, and the `PUID` and `PGID` variables give the files to a different user. Git refused such a directory, thus the branch did not show for those users.

## [4e97712](../../commit/4e97712) - 2026-08-07

### Fixed

- The image holds git. Without it the branch of a stack that is a git checkout did not show, and the **Pull & Redeploy** button did not show. The **Health** page made this visible.

## [eb8e5ff](../../commit/eb8e5ff) - 2026-08-07

### Fixed

- The env row editor does not write a variable with a bad key. A line such as `=value` stops each docker command of the stack. The **Global .env** page has the same editor, thus one bad line there stopped each stack.
- The timers of the **Pull & Redeploy** action and the **Health** page keep their handles in their own function. A late answer of an earlier request stopped the timer of a later request before.
- A late answer of a pull loads the stack again. The editor kept the files from before the pull, and a save wrote them back.
- The env row editor examines the raw compose text again. A check of the substituted text only cleared a real error message.
- A dialog on top owns the Escape key. The previous test did not work, because bootstrap removes its class before the handler of the page.
- Edit mode ends a merged configuration request that still waits.
- The status polls keep their timers in the page object. Two pages could stop the timers of each other before.
- The unmount does the same operations as the router guard, thus the server does not keep this client in the log terminal.
- The health checks have a timeout of 30 seconds and a buffer of 10 MiB.
- The merged configuration refuses an unmanaged stack in the handler, thus the message follows the usual translation.
- A failure for one client does not stop the info broadcast to the other clients.
- The poll interval goes in each info event. A value that was absent one time put the polls back to the default after each new connection.
- A settings save answers each error, thus the settings page does not wait.
- The end of a height drag takes the last position of the pointer.

## [ab0c817](../../commit/ab0c817) - 2026-08-07

### Fixed

- The height of a panel comes from a CSS class with a variable. A narrow window ignores the height of the file row, because the stacked panels there need their full height.
- The drag handles use pointer events, thus they work on a touch device.

## [0c83318](../../commit/0c83318) - 2026-08-07

### Fixed

- The env row editor keeps the line ends of the file. A file from Windows showed each variable as a read-only line before.
- The editor keeps the last line of the file as it is. An edit added a line end and made the stack dirty before.
- The **Global .env** page under **Settings** has the same row editor.

## [7ae3c93](../../commit/7ae3c93) - 2026-08-07

### Fixed

- A settings save sends the new values to each client with a login. Only the client that saved got them before.
- The server keeps the stored poll interval in its limits. Only the browser form held the limits before.

## [f7064a0](../../commit/f7064a0) - 2026-08-07

### Fixed

- The validation gives docker the stack directory as the project directory. A reference to a file of the stack, for example `env_file`, stays correct.
- The **Validate** button is not usable while a validation runs. Each extra click started one more docker process before.

## [ab0fc57](../../commit/ab0fc57) - 2026-08-07

### Fixed

- The merged configuration is an overlay of the stack page, not a dialog. A dialog that closed during a page change kept the scroll lock on the body.
- The docker process gets a buffer of 10 MiB and a timeout of 30 seconds. An output over 200 KiB stopped the command before.

## [d3868be](../../commit/d3868be) - 2026-08-07

### Fixed

- `git pull` cannot ask for credentials on the progress terminal. A question there gets no answer, and the pull would never end.
- A detached HEAD shows the short commit hash, and the **Pull & Redeploy** button does not show.
- The dot after the branch does not count untracked files.

## [920cbe0](../../commit/920cbe0) - 2026-08-07

### Fixed

- The git processes of a stack have a timeout and a large buffer. A slow filesystem or a repository with many changes stopped the stack page before.
- An edit in the env rows does not write the compose file again. Before, it made the YAML text again and lost the format of the user.
- The **Pull & Redeploy** action has a timeout. An agent that disconnected during the pull left each button disabled before.
- The status polls stop when the page goes away without a route change, for example after a failed login.
- An empty poll interval field saves the default of 5 seconds. It saved the minimum of 2 seconds before.
- A close of the merged configuration view ends its request. The two buttons stayed disabled until the timer before.
- A failure of the info broadcast cannot stop the server.
- A variable with a bad key keeps its text in the file. A change to the text view lost the value before.
- The **Health** page has a timeout, and an error removes the old results.
- The merged configuration refuses a stack that this application does not manage.
- A dialog on top owns the Escape key.
- An editor in edit mode can go down to the same height as the other panels.
- The health checks accept the line ends of Windows.
- A rejection that is not an Error object goes in the log again.

## [3c27d54](../../commit/3c27d54) - 2026-08-07

### Added

- Drag handles below the compose panels, the logs panel, and the compose and override editors in edit mode. A drag changes the height of the panel. A double click gives the default height back. The heights are not saved.

## [45bb0f5](../../commit/45bb0f5) - 2026-08-07

### Added

- A row editor for the `.env` panel. Each variable has one field for the key and one field for the value. The values are not masked. A button changes between the rows and the plain text.

## [92af193](../../commit/92af193) - 2026-08-07

### Added

- A setting for the poll interval of a stack page, under **Settings** > **General**. The default stays 5 seconds. A larger value decreases the load on a slow host.

## [478f075](../../commit/478f075) - 2026-08-07

### Added

- A **Validate** button in edit mode. It examines the editor content with `docker compose config` in a temporary directory, without a save. Docker finds problems that a YAML check cannot see.

## [4f7cd88](../../commit/4f7cd88) - 2026-08-07

### Added

- A **Merged config** button on the stack page. It opens a read-only view with the output of `docker compose config`. If the configuration is not correct, the view shows the error text of docker.

## [5681d78](../../commit/5681d78) - 2026-08-07

### Added

- The stack page shows the git branch when the stack directory is a git checkout. A dot shows tracked changes that are not committed. A **Pull & Redeploy** button runs `git pull` and then deploys the stack.
- A **Health** page under **Settings**. It shows if Docker, Docker Compose, and Git are on the server. It also shows if the server can write in the stacks directory and the data directory.

## [d89d469](../../commit/d89d469) - 2026-08-07

### Fixed

- The panels of the stack page keep their positions on a narrow window. Below 992 pixels the file panels go one above the other, but the row kept a share of the height, thus the text of the override editor went over the log panel.

## [cece10d](../../commit/cece10d) - 2026-08-07

### Fixed

- An empty list no longer stays in the compose file. When the user removed the last item of a list, such as a URL or a port, the key stayed with an empty value, and a save put it in the file. The x-dockge object also goes away when it holds nothing more.

## [1a33365](../../commit/1a33365) - 2026-08-07

### Changed

- A new override file holds comments and an example. Before, it held an empty services map, which put braces in the editor. A test shows that docker accepts a file with only comments.

### Fixed

- A save accepts an override file that holds only comments. Before, it refused such a file although docker accepts it.

## [a8df589](../../commit/a8df589) - 2026-08-07

### Added

- A settings page that holds the template of a new override file. The stack page reads this text when the user makes an override file. The template is a file in the data directory, and it exists only when the text is different from the default.

## [cf5e9cf](../../commit/cf5e9cf) - 2026-08-07

### Removed

- The comparison of the frontend version with the backend version on the About page. The two come from one image and one build, thus they cannot be different.

## [967f91a](../../commit/967f91a) - 2026-08-07

### Fixed

- An empty networks key no longer goes in the compose file. The network panel wrote the key each time edit mode opened, thus a save put it in the file of a user who changed nothing.

## [ea22fc0](../../commit/ea22fc0) - 2026-08-07

### Fixed

- The stack list hides the stack of the manager itself when its name is dockge-mod. Before, it looked only for the name dockge, and the README gives the directory /opt/dockge-mod.
- The healthcheck reads DOCKGE_HOSTNAME. The server binds the address of that variable, thus a container stayed unhealthy when a user set it.

### Changed

- Three messages of the agent dialog say agent, not Dockge. An agent can be either program.

### Removed

- The @actions/github package, which the removed workflow used.

## [0dbd0e7](../../commit/0dbd0e7) - 2026-08-07

### Added

- Each published image gets the version 1.5.0-mod-SHORTSHA, as a tag and in the interface. A user can now select a version and go back to an earlier image. Only the master branch moves the latest tag.
- A CI job that builds the image. Before, only the publish workflow built it, and that workflow pushes.

### Fixed

- The interface reloads itself after an update. Before, each image gave the same version, thus an open page kept a request for a file that the new image does not hold.

### Changed

- The publish workflow has a concurrency group, and a cache error no longer fails a build that is already pushed. The tag and the platform inputs go away, because a wrong value could put a partial image on the latest tag.

### Security

- The CI workflow asks for the read permission only.
- The healthcheck binary joins the ignore list of the build context, so a local build of it cannot take the place of the binary for the target architecture.

## [5dc0c7c](../../commit/5dc0c7c) - 2026-08-07

### Removed

- The release tools of the upstream project: the changelog tool, the version tool, and the nightly tool. The nightly stage of the Dockerfile goes away with them, because the workflow builds only the release target.

## [243af3f](../../commit/243af3f) - 2026-08-07

### Changed

- The crash message, the lost-connection banner, and the security policy name this fork. Before, they sent the user to the upstream repository, to the wiki of a different project, and to the advisory address of the upstream project.
- The installed application name, the first-run page, and three server messages say dockge-mod. The package holds the name of this fork, the repository, the home page, and the issue address.
- The translation guide says where the language files come from. This fork has no Weblate project.

## [c90b019](../../commit/c90b019) - 2026-08-07

### Changed

- The README uses the published image for the install and the upgrade. The build steps move to an optional section. The sample compose file uses the published image.

### Added

- A README section that tells how to configure a reverse proxy for the WebSocket connection.

## [e66f2db](../../commit/e66f2db) - 2026-08-07

### Added

- A manual workflow that builds the release image for amd64, arm64, and armv7, and pushes it to ethanpil/dockge-mod on Docker Hub. The tag and the platforms are inputs.

## [334c1c8](../../commit/334c1c8) - 2026-08-07

### Changed

- The Dockerfile builds its base layer and its healthcheck binary from the source in this repository. Before, it took two images from the registry of the upstream project, and the build stopped if those images went away. The healthcheck compiles for the target architecture on the build platform, thus it does not run under emulation.

### Removed

- The npm scripts that push to the registry of the upstream project, with their helpers env2arg.js and test-docker.ts. The workflow of the repository now builds the image.

## [9261414](../../commit/9261414) - 2026-08-07

### Fixed

- The CI workflow runs again. The checkout step had a run key and a uses key together, which is not a valid step.

### Changed

- CI runs on Ubuntu only. Before, the matrix also named Windows, macOS, and two self-hosted runners that do not exist for this repository. The workflow could not start, thus no system had a test.

## [e77eb25](../../commit/e77eb25) - 2026-08-07

### Removed

- The automation and the community files of the upstream project: the nightly release, the issue automation, the file guard, the JSON and YAML validation, the funding file, and the issue, discussion, and pull request templates.

## [fb3b473](../../commit/fb3b473) - 2026-08-06

### Changed

- The README says that the fork adds new features, and not only interface changes. A new section tells how to go back to Dockge, and gives the two conditions that apply after that.

## [ced7f7d](../../commit/ced7f7d) - 2026-08-06

### Changed

- The README gives the features and the use of the override file, and the names that dockge-mod examines.

## [d4a5589](../../commit/d4a5589) - 2026-08-06

### Fixed

- A stack directory whose name starts with two dots opens again. The new path guard refused each such name, but a name such as ..foo stays in the stacks directory.

## [a9a3f0a](../../commit/a9a3f0a) - 2026-08-06

### Changed

- The editors on the stack page use one set of properties, and the dirty test compares the full edit state. A new field in the edit state now gets a dirty mark without a second change.

## [df54017](../../commit/df54017) - 2026-08-06

### Fixed

- A save sends the override file only when the user changes it. Before, each save sent the override, so it could remove a file that a different user or a tool made after the page loaded.
- The editors keep the dirty mark for text that the user writes while a save is in progress. Before, an empty override in that save marked the new text as saved, and the text could go away with no question.
- The reply to a deploy uses the values that went to the server. Before, it read the editor, so it could hide an override file that is on the disk, or show one that is not.
- The Create override button gives back the content of a file that the user deleted in the same session. Before, it put the template in the editor and the content went away.
- Discard leaves edit mode after the stack arrives, so view mode does not show the content that the user discarded.

## [312c5d9](../../commit/312c5d9) - 2026-08-06

### Changed

- The deployStack and the saveStack handlers use one helper for their arguments. The two copies of that block had to stay the same, or one event would accept the old clients and the other would not.

## [d4f1ce9](../../commit/d4f1ce9) - 2026-08-06

### Fixed

- The search for the override file uses the sequence that docker uses. Docker examines four names and uses the first file that it finds, and the name of the base compose file has no effect on that sequence. Before, the interface could hide a file that docker uses, or show a file that docker ignores.
- The save refuses a link or a directory that has the name of the override file. Such a file could look absent in the interface, and then go away in a subsequent save.
- The search for the file name is lazy, so the stack list does not examine the disk for a name that it does not use.

## [5f5a30d](../../commit/5f5a30d) - 2026-08-06

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
