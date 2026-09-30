# Changelog

Changes in dockge-mod compared with [Dockge](https://github.com/louislam/dockge). dockge-mod is based on Dockge commit [`f809ae1`](https://github.com/louislam/dockge/commit/f809ae192b571944ad773e9866d3e67064ae8043) and stays compatible with the data, the stacks directory, the environment variables, and the agents of Dockge 1.5.0 and later.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each release is a git tag named after the image version. From October 2026 the version holds the build date, for example `1.5.0-mod-2026-10-01`; the first two releases used the commit hash. The commit history has the full detail.

## [Unreleased]

### Fixed

- **Pull & Redeploy** in a checkout owned by another user left root-owned files, and the owner's own git commands then failed. The files now go back to the owner after each pull. ([98cb6c2])

## [1.5.0-mod-2026-09-30] - 2026-09-30

### Changed

- New logo: a cargo ship, in the interface, the favicon, and the app icons.
- Image version tags hold the build date, for example `1.5.0-mod-2026-10-01`, so they sort by release.

## [1.5.0-mod-38b177a] - 2026-09-29

### Security

- Port links and `x-dockge` URLs are links only when they are http or https. The port text can come from an agent. ([8707181])
- `git status` for the branch badge runs as the owner of the checkout, and **Pull & Redeploy** runs without repository hooks. Repository config (filter drivers, hooks) could run commands as root when a stack page was opened. ([b10d053])
- One address could lock out every login. Each refused attempt used up the global login limit before the per-address limit was checked. ([3a8a440])
- The SSL key passphrase is no longer written to the debug log. ([3a8a440])

### Fixed

- Terminals keep their size after a reconnect, and the Logs panel keeps streaming. Shells on an agent survive a short drop of the link to the agent. ([9a9f155], [5f93947])
- The bulk-action confirmation could not be clicked. ([9a9f155])
- The container table showed old rows as current when `docker compose ps` failed. ([9a9f155])
- Removing many unused resources reported a timeout while it still ran. ([9a9f155])
- A request to an offline agent waited for the full time limit (5 minutes per stack in a bulk action) instead of failing at once. ([5f93947])
- A container that crashed within a minute of a restart or a redeploy sent no alert. ([5f93947])
- The memory and load tiles waited for `docker system df`, which now refreshes in the background every 10 minutes. ([5f93947])
- Docker Hub images that a compose file names by digest (`docker.io/library/postgres@sha256:...`) were offered for removal after the stack went down. ([45e0a42])
- Image update check ([e67d554]):
  - A pull during a running check brought the update badge back.
  - A `docker login` with a credential store made every Docker Hub image fail. Public images are now read anonymously.
  - Images named with the default port (`registry:443/...`) always failed.
  - Edits to compose files made outside dockge-mod were not checked.
- The image update check could use up the Docker Hub pull limit. After one registry timeout, every other Docker Hub image went to `docker buildx imagetools inspect`, which counts as a pull. The check now only uses HEAD requests, and stops asking a registry for the rest of the check after HTTP 429 or a network error. ([51973af])
- The update badge now clears when **Update** pulls the new image, instead of at the next six-hour check. ([4c4e9e5])
- A stack stopped outside dockge-mod (for example with `docker compose down`) kept its old status in the list. ([4c4e9e5])
- A deploy sent while another operation ran changed the files and then failed. It now fails before it saves. ([4c4e9e5])
- Containers with their own stop signal, such as nginx and postgres, sent a false "container exited" alert when stopped. ([4c4e9e5])
- A late answer to a deploy, save, or delete no longer takes you back to a stack page you left. Switching quickly between stacks no longer leaves `docker compose logs -f` processes running. ([54725af])
- The "Compose your first stack" link never showed in an empty stack list. ([54725af])
- **Add Agent failed on a database created by Dockge 1.5.0.** Upstream added an agent name column by editing an old migration, so the column does not exist there. Agent names are now optional, and agents without a name show their host. ([21ff72a])
- Container statuses were wrong between dockge-mod and Dockge 1.5.0 servers in both directions. The status answer uses the 1.5.0 format again, and the container details go in a new field. ([21ff72a])
- The per-service start, stop, and restart actions are hidden for Dockge 1.5.0 agents, which do not have them. They locked the stack page for five minutes. ([21ff72a])
- The healthcheck failed when `DOCKGE_HOSTNAME` is a wildcard or an IPv6 address. ([21ff72a])
- A user with 2FA set in the database got no login token. 2FA cannot be set up in Dockge or dockge-mod, so the login now gives a clear error. ([3a8a440])

### Changed

- Discard asks first when there are unsaved changes. **Pull & Redeploy** and the bulk stop, restart, and update actions ask first. ([54725af])
- The stack page shows a loading state and a Retry button. The Resources tables show "Loading" while they load. ([54725af])

### Removed

- The `docker buildx imagetools` fallback of the image update check. Private images whose credentials are in a credential helper are not supported. ([51973af])

## [1.5.0-mod-c056412] - 2026-09-01

First release. Differences from Dockge:

### Added

- Override file editor. Docker Compose merges the override file with the compose file.
- Git checkouts as stacks, with the branch in the stack list and a **Pull & Redeploy** button.
- Image update check every six hours, with a badge on stacks that have newer images.
- Notifications to a webhook, ntfy, or Apprise for new image versions, containers that exit with an error, and unhealthy containers.
- Backups of stack files. Each save and git pull keeps a copy; the last 20 per stack can be restored.
- **Resources** page for images, volumes, and networks. Removing unused items shows the list first and keeps everything that belongs to a stack.
- Per-service logs, a **Validate** button, and a **Merged config** view.
- `.env` editor with a row per variable, and a **Global .env** page.
- **Health** page for the tools and directories the server needs.
- Host load, memory, and Docker disk usage on the home page.
- Bulk actions and a status filter in the stack list.
- Resizable panels.
- Test suite, CI, and a multi-arch image that includes the frontend build.

### Changed

- New theme and stack page layout.
- Docker queries time out after 30 seconds. Compose operations are stopped after 60 minutes.
- The login limit is per address, with a higher limit for all addresses together.
- The image builds its own base layer, with git and the buildx plugin.

### Fixed

- A late terminal exit event could remove a newer terminal with the same name.
- Many smaller fixes to the interface, the terminal, and compose operations.

### Security

- A stack name cannot point outside the stacks directory.
- A service name or shell name cannot add a flag to a docker command.

### Removed

- The check for a new Dockge version on GitHub.

[Unreleased]: https://github.com/ethanpil/dockge-mod/compare/1.5.0-mod-2026-09-30...HEAD
[1.5.0-mod-2026-09-30]: https://github.com/ethanpil/dockge-mod/releases/tag/1.5.0-mod-2026-09-30
[1.5.0-mod-38b177a]: https://github.com/ethanpil/dockge-mod/releases/tag/1.5.0-mod-38b177a
[1.5.0-mod-c056412]: https://github.com/ethanpil/dockge-mod/releases/tag/1.5.0-mod-c056412
[9a9f155]: https://github.com/ethanpil/dockge-mod/commit/9a9f155
[5f93947]: https://github.com/ethanpil/dockge-mod/commit/5f93947
[45e0a42]: https://github.com/ethanpil/dockge-mod/commit/45e0a42
[b10d053]: https://github.com/ethanpil/dockge-mod/commit/b10d053
[e67d554]: https://github.com/ethanpil/dockge-mod/commit/e67d554
[54725af]: https://github.com/ethanpil/dockge-mod/commit/54725af
[4c4e9e5]: https://github.com/ethanpil/dockge-mod/commit/4c4e9e5
[3a8a440]: https://github.com/ethanpil/dockge-mod/commit/3a8a440
[51973af]: https://github.com/ethanpil/dockge-mod/commit/51973af
[21ff72a]: https://github.com/ethanpil/dockge-mod/commit/21ff72a
[8707181]: https://github.com/ethanpil/dockge-mod/commit/8707181
[98cb6c2]: https://github.com/ethanpil/dockge-mod/commit/98cb6c2
