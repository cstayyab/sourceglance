# Changelog

All notable changes to sourceglance are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Preview** an issue, pull or merge request, or project draft from its row in the window,
  in a panel on the right beside the list: the description, which you can edit, then its
  comments and reactions (read only) and a box to add a comment. Drag the panel's edge to
  resize it. Project drafts show their description only.
- A small **Markdown editor** for comments and descriptions, with a toolbar for bold, italic,
  strikethrough, inline code, bulleted and numbered lists, quotes and code blocks, plus
  Ctrl+B, Ctrl+I and Ctrl+Enter to post.
- **Labels and assignees as chips** under an item's title, labels in their own colour: **×**
  removes one, **+** lists what you can add. An arrow at the end of the row shows or hides
  them; rows start collapsed.
- The **Comment** button shows how many comments an item has, on its corner.
- **Project drafts can be assigned** (to you, or whoever is already on them).
- **Tasks filters**: **Kind**, **Accounts**, **Labels** and **Assignee** are separate buttons,
  each a check list with counts. What you pick shows as chips on the row below them.

### Changed

- Rows in the window's lists no longer expand into a row of buttons: their actions are icons
  on the title line (hover one for its name), and Open uses the external-link arrow. Tasks
  rows have the same actions as the lists, rather than only opening in the browser.
- Filter chips on the Tasks page are rounded rectangles, like the rest of the window.

## [0.6.0] - 2026-11-18

### Added

- **Tasks**: one list at the top of the window with everything assigned to you, from every
  account: issues, pull or merge requests and project drafts, newest first. Icons tell them
  apart. Filter it like a tag search: **+ Filter** adds a kind (Issues, Pull requests,
  Projects) or an assignee (one of your accounts), each filter shows as a chip with **×**, and
  **Clear filters** removes them all. Click a task to open it in your browser. Issues, Pull
  requests and Projects now sit under Tasks in the sidebar, collapsed until you open them.

### Removed

- The outdated screenshots on the home page, in the README and in the install guide. New ones
  will follow once the window settles.

## [0.5.0] - 2026-11-18

### Added

- When you log in and a newer version is out, a notification says so with short release
  notes. **Install** opens the window and starts the update, as **Update available** does.
  Turn it off with **Check for updates** in Settings → System Start.
- Repository headings in the lists collapse: click one to hide or show its issues or pull
  requests, in the window and in the top-bar menus alike. Project boards in the window's
  Projects list collapse the same way. The heading keeps its count, Source Glance remembers
  what you collapsed, and a search shows matches in collapsed repositories too.
- A **Wallpaper** section in Settings → Desktop Widgets recommends Adwaita, GNOME's default
  wallpaper (from GNOME Backgrounds), to go with the cards, with a preview. **Apply** sets it
  and keeps yours; **Reset** puts yours back. If you change the wallpaper any other way, Reset
  isn't offered any more, only Apply.
- **Several accounts.** Add more than one GitHub or GitLab account under Settings → Accounts,
  for example a personal and a work account. Each account gets its own collapsible section in
  the lists and the top-bar menus, and comments, closing, labels and assignees run as the
  account the item came from. Your existing GitHub and GitLab sign-ins carry over without
  signing in again.
- **Self-hosted instances.** **Connect a self-hosted instance** adds GitLab self-managed or
  GitHub Enterprise Server. Source Glance checks the address really is that platform, then
  signs in in the browser (with an app you register on the instance; GitLab 17.1 or later)
  or with a personal access token. It uses `https://`, or plain `http://` only for an
  instance on your local network, checked every time it connects.
- **Personal access tokens** for every platform, next to signing in in the browser. Each
  sign-in option says which repositories it reaches: only yours and your organizations', or
  everything you can view.

### Changed

- The app is now called **Source Glance** everywhere you see its name: the top bar, the window,
  the app grid, Setup and the home page.

### Fixed

- The window now shows as Source Glance in the dock and in Alt+Tab, with its own icon, instead
  of as GNOME's Extensions app. It opens in Source Glance's own app; opening it again brings the
  open window forward.

## [0.4.2] - 2026-11-17

### Fixed

- An item's actions in the top-bar lists (Open, Comment, Close, Assignees, Labels, status) no
  longer get clipped to a sliver when the list is taller than the screen. Clicking an issue,
  pull request or draft now opens its actions in a menu beside the list, and long lists
  scroll ([#57](https://github.com/omer-gh/sourceglance/pull/57)).

## [0.4.1] - 2026-11-16

### Fixed

- Setup no longer tries to restart sourceglance when a development build (`make reload`) was
  installed: GNOME Shell may still be running that build's loader, so the restart left
  sourceglance in an error state until the next login. Setup now asks you to log out instead.

## [0.4.0] - 2026-11-16

### Changed

- The search box sits on the right of the window's title bar and is always shown, on every
  page. Searching from a settings page opens the first list; clearing the search restores
  every list's results and counts and keeps the list you're on (or opens the first list).

## [0.3.0] - 2026-11-16

### Added

- **Update available** in the window's title bar when a newer version is out. Clicking it
  downloads the new Setup for your PC, checks it against the release's `SHA256SUMS`, and
  opens it only if it matches; when Setup finishes, the window reopens on the new version.
  Turn the check off in Settings → System Start → **Check for updates**.
- **Updates without logging out**: Setup installs each version in its own folder behind a
  small loader, and restarts sourceglance after updating, so the new version runs straight
  away. Coming from v0.2.0 or earlier, log out once after this first update.
- An **Update, repair or remove** section on the home page.
- **Search** in the window's title bar: filter Issues, Pull requests and Projects by title,
  repository, number, label, person or board status. The sidebar counts and the title bar
  show the matches; clear the box, press Esc or click **Clear search** to see everything
  again. Start typing on a list, or press Ctrl+F, to search.

### Changed

- **Accounts** is one page under Settings, with **GitHub** and **GitLab** as its sections,
  instead of two sidebar entries.
- When GitHub refuses a change (comment, close, labels, assignees, status), sourceglance now
  says why: the sourceglance app isn't installed on that repository, or you don't have
  permission, and you can make the change on GitHub instead. Public repositories you don't
  own show up without the app; changing them needs the owner to install it.

## [0.2.0] - 2026-11-16

### Added

- **About sourceglance** in the sourceglance menu, and an **About** page in the window:
  the version, the author (Mohammad Omer, [@omer-gh](https://github.com/omer-gh)), and links
  to **Report an issue**, **Fork and contribute**, the contributing guide, the home page,
  source code, release notes and license.
- The README and home page invite you to report issues and to contribute by forking the
  repository and opening a pull request.
- Screenshots of the desktop widgets, top-bar menu and main window in the README and on the
  home page.

## [0.1.0] - 2026-11-16

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
- **GitLab (gitlab.com)**: sign in from the window (Settings → Accounts → GitLab, device
  flow). Your GitLab issues and merge requests appear in their own collapsible section of
  each list, menu and widget, with the same actions; counts add up across both.
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

[Unreleased]: https://github.com/omer-gh/sourceglance/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/omer-gh/sourceglance/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/omer-gh/sourceglance/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/omer-gh/sourceglance/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/omer-gh/sourceglance/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/omer-gh/sourceglance/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/omer-gh/sourceglance/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/omer-gh/sourceglance/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/omer-gh/sourceglance/releases/tag/v0.1.0
