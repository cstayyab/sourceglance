# Changelog

All notable changes to sourceglance are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Sign in with GitHub** in Settings, using the device flow: sourceglance copies a code
  and opens GitHub, you approve, done. It uses a GitHub App limited to issues, pull
  requests and project boards, on the repositories you choose: no code or settings access.
- **Pull requests** in the menu: open PRs assigned to you or awaiting your review.
- **Top-bar buttons** for Issues, Projects, Pull requests and sourceglance, each with its own
  count, as separate icons or as tabs in one menu (Settings → Top bar), where you also choose
  which lists to show.
- **Projects list**: draft items on your personal and organization project boards, grouped
  by status, with **Move to status…**.
- The Issues and Pull requests lists always end with how many closed items are still
  assigned to you, linking to them on GitHub.
- **Start automatically** and **Quit** at the bottom of the sourceglance menu. Quit hides
  sourceglance and stops refreshing until you choose **Start now** in Settings.
- **sourceglance window** (the app icon, or Settings): a sidebar with your Issues, Pull
  requests and Projects, with counts and the same actions as the menus, and the settings
  pages (Desktop Widgets, System Tray, Accounts, System Start), in the top-bar blue.
- **Desktop widgets**: Summary, Issues, Pull requests and Projects cards on the desktop,
  below your windows and above desktop icons. Drag them by their header; choose cards and
  opacity in Settings → Desktop Widgets.
- **Splash window** when sourceglance starts from its app icon, with its version and the
  start-up steps.
- **App icon** in the app grid and dock: starts sourceglance (also after Quit) and opens its
  Settings. Turn it off with Settings → Top bar → Show in app grid.
- **Filter by label**: a dropdown on the Issues and Pull requests headings shows only items
  with the chosen label. The menu stays open while you pick.
- **Actions from the top bar** on every issue and PR: comment, close (with confirmation)
  and reopen from **Recently closed**, edit assignees and labels, and move it between
  statuses on its project boards.
- The sign-in is validated and stored in the GNOME keyring. Sign out removes it.
- When nothing is found, the menu hints that sourceglance only sees the repositories it was
  given.
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
- Writes only happen from a menu action. Repository names, numbers, logins, label names
  and project IDs are validated before they reach a request.
- The token lives only in the GNOME keyring and is never logged.

[Unreleased]: https://github.com/omer-gh/sourceglance/commits/main
