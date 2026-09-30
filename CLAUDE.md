A primary goal of this project is to keep drop-in compatibility with Dockge: the 1.5.0 release (what users run) and upstream master at the base commit. Never make a change that breaks that promise. If I ask for a change that breaks it, require double confirmation.

- New state goes in `mod_*` tables through `backend/migrations-mod/` (ledger `mod_knex_migrations`). Never change Dockge tables, the Dockge migration ledger, or the argument order and answer shape of an existing socket event. New socket fields and events only add data.
- `test/backend/database-dockge-150.test.ts` covers a database created by Dockge 1.5.0.

Write README files, commit messages, changelogs, documentation, and comments in plain, succinct, clear English.

Group related work into one commit, then push. Do not make one large mixed commit.

# Changelog

Keep a Changelog format. Keep entries short, and reference the commit hash where it helps.

- Changelogs are for humans, not machines.
- Put new entries under `## [Unreleased]`. A release moves them to `## [<tag>] - YYYY-MM-DD`. The tag is the image version that the publish workflow prints: `<package.json version>-mod-<YYYY-MM-DD>`, with `-2`, `-3` for more releases on one day.
- The latest changes come first.
- Group entries by type: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
  - `Fixed`: the behavior was wrong and is now correct.
  - `Changed`: the behavior worked as intended and now works differently.
  - `Security`: the change addresses a vulnerability.
- Only list changes that a user of a release can see. A fix to a feature that was never released is not an entry.
