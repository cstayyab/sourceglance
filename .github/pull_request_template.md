<!-- markdownlint-disable-file MD041 -->
## What does this change?

<!-- A short summary. The PR title should follow Conventional Commits, e.g. "feat(panel): add unread badge". -->

Closes #

## How was it tested?

<!-- e.g. "Nested Wayland session on Ubuntu 24.04, GNOME Shell 46; enabled/disabled 5 times." -->

## Screenshots

<!-- For UI changes. Make sure no tokens or private repo names are visible. -->

## Checklist

- [ ] `make lint` passes
- [ ] Tested in a nested GNOME Shell session
- [ ] Everything created in `enable()` is cleaned up in `disable()`
- [ ] Docs updated (if behaviour, settings or setup changed)
- [ ] `CHANGELOG.md` updated under `## [Unreleased]` (if user-visible)

### Security (see docs/security/secure-development.md)

- [ ] No tokens or secrets in code, logs, errors, fixtures or screenshots
- [ ] GitHub data treated as untrusted (plain text, URLs checked); no secrets in GSettings
- [ ] No new runtime dependencies; network calls only to api.github.com
- [ ] Threat model updated, or not needed for this change
