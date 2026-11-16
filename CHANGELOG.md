# Changelog

All notable changes to sourceglance are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Sign in with GitHub** in Settings, using the OAuth device flow: sourceglance copies a
  code and opens GitHub, you approve, done. Sees issues in every repository you can
  access, including other people's private repositories you collaborate on.
- Sign in with a GitHub personal access token in Settings; the token is validated and
  stored in the GNOME keyring. Sign out removes it.
- When no issues are found, the menu hints that a token may not reach every repository.
- The top-bar menu lists your open assigned issues, grouped by repository, newest first,
  with a "View all on GitHub" link. Click an issue to open it in your browser.
- The top-bar icon shows how many open issues are assigned to you.
- Optional list of repositories to watch.
- Auto-refresh on a configurable interval, plus a manual **Refresh** item. Waits for
  GitHub's rate-limit reset when needed.
- Clear menu messages when signed out, loading, empty, or when GitHub can't be reached.
- **sourceglance Setup**: a double-clickable installer (AppImage) with an MSI-style wizard —
  license agreement, system check, progress with automatic rollback, and Repair / Remove
  when run again. Also scriptable from the command line. See
  [Installing sourceglance with Setup](docs/installing.md).
- `tools/preview.sh` to preview locally in a nested GNOME Shell or your own session,
  with one-time setup, a risk warning and MIT License agreement.
- Project docs: contributing guide, issue and PR templates, release process.

### Security

- Only `https://github.com/` links from GitHub data can be opened from the menu.
- The token lives only in the GNOME keyring and is never logged.

[Unreleased]: https://github.com/omer-gh/sourceglance/commits/main
