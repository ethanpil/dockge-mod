A primary goal of this project is to retain drop-in compatibility with the original dockge project so we should never make any changes that would break that promise. If I ask for a change that breaks that promise require double confirmation!

When writing readme files, commit messages, changelogs, documentation and comments, use ONLY ASD-STE100 Simplified Technical English.

When sending commits, always group logal work together in a commit and then push. Dont just sent it all in one big spaghetti commit.


# changelog

Maintain the changelog as we progress over time. We use a Keep a Changelog format plus ASD-STE100 Simplified Technical English.

## Changelog Guiding Principles

- Changelogs are for humans, not machines.
- There should be an entry for every single version.
- The same types of changes should be grouped. (By version or commit has if the project has no versioning/releases)
- The latest changes come first.
- The release date of each version/commit is displayed. Use YYYY-MM-DD format.
- Use ASD-STE100 Simplified Technical English

## Types of changes (groups)
- `Added` for new features.
- `Changed` for changes in existing functionality.
- `Deprecated` for soon-to-be removed features.
- `Removed` for now removed features.
- `Fixed` for bug fixes.
- `Security` for vulnerabilities.

Usually the right type is clear. Three of them cause the most questions:

- `Fixed`: the behavior was wrong, and is now correct.
- `Changed`: the behavior worked as intended, and now works differently.
- `Security`: the change addresses a vulnerability. It could fit under Fixed or Changed, but its urgency and audience are different.

When you are unsure, ask whether the old behavior was a bug. If it was, use `Fixed`. If it was intentional and you are changing it, use `Changed`.