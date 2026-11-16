# sourceglance

**Your GitHub and GitLab issues, pull requests and project boards, one glance away: in the
Ubuntu top bar, in their own window, and right on your desktop.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Lint](https://github.com/omer-gh/sourceglance/actions/workflows/lint.yml/badge.svg)](https://github.com/omer-gh/sourceglance/actions/workflows/lint.yml)
[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-46--50-4a86cf)](src/metadata.json)
[![Release](https://img.shields.io/github/v/release/omer-gh/sourceglance?include_prereleases)](https://github.com/omer-gh/sourceglance/releases)

**Home page and download: <https://omer-gh.github.io/sourceglance/>** ·
Made by **Mohammad Omer** ([@omer-gh](https://github.com/omer-gh))

sourceglance is a GNOME Shell extension for Ubuntu Desktop. It shows what's assigned to you
on GitHub and gitlab.com, and lets you act on it, without opening a browser:

- **Top-bar buttons** for Issues, Pull requests and Projects, each with a live count.
- **Desktop widgets**: cards with your lists, pinned to the desktop under your windows.
- **A main window** with every list and all settings in one place.

![sourceglance desktop widgets and top-bar buttons on an Ubuntu desktop](docs/images/widgets.png)

> **Status: first release.** v0.1.0 is out as a pre-release. Try it, and
> [report anything odd](https://github.com/omer-gh/sourceglance/issues).

## Features

- **Desktop widgets**: Summary, Issues, Pull requests and Projects cards on your desktop.
  Drag them anywhere, set their opacity, click an item to open it.
- **Top bar**: buttons for sourceglance, Issues, Pull requests and Projects as one tinted
  group or as tabs in one menu, each with its count (0 included).
- **Act from anywhere**: comment, close or reopen, edit assignees and labels, and move
  items between statuses on your project boards, from the menus or the window.
- **GitHub and GitLab**: gitlab.com issues and merge requests get their own collapsible
  section in every list, menu and widget; counts add up across both.
- **Projects**: draft items on your GitHub Projects (v2) boards, grouped by status.
- **Filter by label**, and see how many closed or merged items are still assigned to you.
- **Main window** with a sidebar for your lists and settings, a splash screen, and an app
  grid icon, all in the top bar's blue.
- **Limited access**: signs in through a GitHub App that can only see issues, pull requests
  and projects (no code). Tokens stay in the GNOME keyring.
- **Start automatically** at login, or **Quit** and start it again from the app grid.
- **One-file installer**: a setup wizard with repair, upgrade and remove.

Planned: desktop notifications for new assignments.

## Desktop widgets

Widgets put your lists on the desktop itself, so a glance at the desktop shows what's
waiting for you. They sit below your windows and above desktop icons, so they never cover
your work and stay clickable.

| Card | Shows |
| --- | --- |
| **Summary** | Open issues, pull requests and project drafts, plus closed and merged items still assigned to you |
| **Issues** | Open issues assigned to you, from GitHub and GitLab |
| **Pull requests** | Pull and merge requests assigned to you or awaiting your review |
| **Projects** | Draft items on your project boards, with their status |

- **Turn cards on or off** in sourceglance → **Settings → Desktop Widgets**. Summary is on
  by default.
- **Move a card** by dragging its header; sourceglance remembers where you put it.
  **Reset positions** puts them all back in a column on the right.
- **Opacity** sets how see-through the cards are.
- **Click an item** to open it in your browser. Each card shows when it was last updated
  and refreshes with the rest of sourceglance.

## Requirements

- Ubuntu 24.04 LTS or newer (or any distro with GNOME Shell 46–50)
- A GitHub or gitlab.com account

## Installation

### Setup wizard (recommended)

1. Download **sourceglance Setup** from the
   [home page](https://omer-gh.github.io/sourceglance/) or
   [Releases](https://github.com/omer-gh/sourceglance/releases): one `.AppImage` file
   (`x86_64` for most PCs, `aarch64` for ARM).
2. In Files, right-click it, choose **Properties** and turn on **Executable as Program**.
3. Double-click it and follow the wizard, then log out and back in.

No admin password, app store or apt/snap repository needed. Run it again later to repair or
remove sourceglance. The [install guide](docs/installing.md) also covers checking the
download.

### From source

```bash
git clone https://github.com/omer-gh/sourceglance.git
cd sourceglance
make install
```

Then log out and back in (on Wayland), and enable the extension:

```bash
gnome-extensions enable sourceglance@omer-gh.github.io
```

### Preview without installing for good

```bash
git clone https://github.com/omer-gh/sourceglance.git
```

```bash
cd sourceglance && ./tools/preview.sh
```

The script explains the risks, asks you to accept the [MIT License](LICENSE) (the software
comes with no warranty), and does any one-time setup. See
[docs/development.md](docs/development.md#preview-script-recommended).

### From extensions.gnome.org

Coming with the first stable release.

## Getting started

Open sourceglance from the app grid (or the sourceglance button in the top bar →
**Settings**), then go to **Accounts**:

1. **GitHub → Sign in.** sourceglance copies a short code and opens GitHub; paste it and
   approve. This gives access to issues, pull requests and project boards only: no code,
   settings or admin access.
2. **Choose repositories** to pick which repositories sourceglance may see. Optionally list
   repositories to watch (`owner/name, owner/other`); leave it empty to see everything
   assigned to you.
3. **GitLab → Sign in** (optional) and approve on gitlab.com the same way. GitLab sign-ins
   renew themselves in the background.

**Repositories owned by someone else:**

| Repository | Shows in sourceglance | Comment, close, labels, assignees, status |
| --- | --- | --- |
| Yours, with the app installed | Yes | Yes |
| **Public**, owned by someone else | Yes, without any setup | Only once the owner installs the app; until then, make changes on GitHub |
| **Private**, owned by someone else | Once the owner installs the app | Once the owner installs the app |

To install the app on a repository, its owner opens
<https://github.com/apps/sourceglance/installations/new> and picks the repository.
Organization repositories need an organization owner to install it.

## Using sourceglance

### Top bar

![The Issues menu with GitHub and GitLab sections](docs/images/menu.png)

The top bar shows sourceglance's buttons as one tinted block, each list with its count:

- **sourceglance**: who you're signed in as, Refresh, Settings and **About sourceglance**,
  plus **Start automatically** and **Quit**. After Quit, start it again from the app grid icon.
- **Issues**: open issues assigned to you
- **Pull requests**: pull and merge requests assigned to you or awaiting your review
- **Projects**: draft items on your project boards, grouped by status

Each list can be filtered by label and ends with how many closed items are still assigned
to you. In **Settings → System Tray** you choose which lists to show, and whether they're
separate buttons or **tabs in one menu**.

### Actions

Click any issue, pull request or merge request, in a menu or in the window, for its actions:

- **Open on GitHub** / **Open on GitLab**
- **Comment…**
- **Close…** (you confirm first; GitHub issues close as completed or not planned) and
  **Reopen**
- **Assignees…** and **Labels…**
- **Board: Status…** for each project board it's on

### Main window

![The sourceglance window with the Issues list and the settings sidebar](docs/images/window.png)

The window has your **Issues**, **Pull requests** and **Projects** in a sidebar, with counts
and the same actions as the menus, and the settings pages: **Desktop Widgets**, **System
Tray**, **Accounts** (GitHub, GitLab) and **System Start** (start at login, app grid icon).
**About** shows the version and the author, with links to report an issue or fork the
repository and contribute.

## Roadmap

| Milestone | Goal |
| --- | --- |
| `v0.1.0` ✅ | Top bar, main window, desktop widgets, GitHub and gitlab.com, setup wizard |
| `v0.2.0` ✅ | About page: version, author, report an issue, fork and contribute |
| `v0.3.0` | Desktop notifications for new assignments |
| `v1.0.0` | Published on extensions.gnome.org |

Details: [docs/product/roadmap.md](docs/product/roadmap.md).

## Contributing

sourceglance is open source, and your help makes it better.

- **Report an issue:** found a bug, have an idea or a question?
  [Open an issue](https://github.com/omer-gh/sourceglance/issues/new/choose). Include your
  Ubuntu and GNOME Shell versions, and what you expected to happen.
- **Contribute code or docs** by forking the repository:
  1. [Fork sourceglance](https://github.com/omer-gh/sourceglance/fork) to your account and
     clone your fork.
  2. Create a branch, make your change, and run `make lint` and `make test`.
  3. Push the branch to your fork and open a pull request against `main`.

  Start with [CONTRIBUTING.md](CONTRIBUTING.md), and look for issues labelled
  [`good first issue`](https://github.com/omer-gh/sourceglance/labels/good%20first%20issue).

- Developer setup: [docs/development.md](docs/development.md)
- Release process: [RELEASING.md](RELEASING.md)
- Security reports: [SECURITY.md](SECURITY.md) (please don't open public issues for these)

Everyone taking part must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Author

**Mohammad Omer**: [@omer-gh](https://github.com/omer-gh) on GitHub.

## License

[MIT](LICENSE) © 2026 Mohammad Omer

sourceglance is not affiliated with or endorsed by GitHub, Inc. or GitLab Inc.
