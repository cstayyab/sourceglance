# sourceglance

**Your GitHub and GitLab issues, pull requests and project boards, one click away in the Ubuntu top bar.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Lint](https://github.com/omer-gh/sourceglance/actions/workflows/lint.yml/badge.svg)](https://github.com/omer-gh/sourceglance/actions/workflows/lint.yml)
[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-46--50-4a86cf)](src/metadata.json)

**Home page and download: <https://omer-gh.github.io/sourceglance/>**

sourceglance is a GNOME Shell extension for Ubuntu Desktop. It puts buttons in the top bar
for your issues, pull requests and project boards; click one to see and act on what's
assigned to you, without opening a browser.

> **Status: early release.** v0.1.0 is the first release. See the [roadmap](#roadmap) and
> the open issues if you want to help.

## Features

- [x] Top-bar buttons for Issues, Pull requests and Projects, each with its count, as one
  group or as tabs
- [x] Sign in with GitHub (device flow) through a GitHub App limited to issues, pull
  requests and projects; tokens stay in the GNOME keyring
- [x] Actions from the menu: comment, close and reopen, assignees, labels, project status
- [x] Filter by label; closed items still assigned to you are counted
- [x] GitHub Projects (v2) draft items, grouped by status
- [x] gitlab.com issues and merge requests in their own sections
- [x] Main window with lists and settings, splash screen, app grid icon
- [x] Desktop widgets
- [ ] Desktop notifications for new assignments

## Requirements

- Ubuntu 24.04 LTS or newer (or any distro with GNOME Shell 46–50)
- A GitHub or gitlab.com account

## Installation

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

### Setup wizard (recommended)

Download sourceglance Setup from the [home page](https://omer-gh.github.io/sourceglance/)
or [Releases](https://github.com/omer-gh/sourceglance/releases), allow it to run once
(**Properties → Executable as Program**), and double-click it. A setup wizard walks you
through the license, a system check and the install — no admin password, app store or
apt/snap repository needed. Run it again later to repair or remove sourceglance. See the
[install guide](docs/installing.md).

### From extensions.gnome.org

Coming with the first stable release.

## Usage

1. Click the sourceglance icon (a branch with an eye) in the top bar and choose **Sign in…**.
2. Click **Sign in with GitHub**. sourceglance copies a short code and opens GitHub in your
   browser; paste the code and approve. Settings shows "Signed in as @you".

   This gives sourceglance access to issues, pull requests and project boards only, and
   nothing else: no code, settings or admin access.
3. Click **Choose repositories** and pick which repositories sourceglance may access. For
   another person's private repository, its owner has to install the app there.
4. Optionally list repositories to watch (`owner/name, owner/other`); leave it empty to see
   everything assigned to you.
5. The top bar shows sourceglance's buttons as one tinted block, each list with its count:
   - **sourceglance**: who you're signed in as, Refresh and Settings, plus **Start
     automatically** and **Quit**. After Quit, start it again from the **sourceglance app
     icon** in the app grid, or Settings → **Start now**.
   - **Issues** (checkbox): open issues assigned to you
   - **Pull requests** (branches): PRs assigned to you or awaiting your review
   - **Projects** (checklist): draft items on your project boards, grouped by status, with
     **Move to status…**

   In **Settings → Top bar** you choose which lists to show, and whether they're separate
   icons or **tabs in one menu**. The Issues and Pull requests lists can be filtered by label,
   and always end with how many closed items are still assigned to you.

   Click any issue or PR for its actions:
   - **Open on GitHub**
   - **Comment…**
   - **Close…**: issues close as completed or not planned; you confirm first. Closed items
     stay under **Recently closed** with **Reopen** until you log out.
   - **Assignees…** and **Labels…**
   - **Board: Status…** for each project board it's on, to move it to another status

**Repositories owned by someone else** (including private ones you collaborate on) appear
once their owner installs the sourceglance app on them: send them
`https://github.com/apps/<app>/installations/new` and ask them to pick the repository.
Organization repositories need an organization owner to install it.

## Roadmap

| Milestone | Goal |
| ----------- | ------ |
| `v0.1.0` | Token sign-in and assigned-issues list |
| `v0.2.0` | GitHub Projects (v2) board view |
| `v0.3.0` | Notifications and unread badge |
| `v1.0.0` | Published on extensions.gnome.org |

Details and acceptance criteria: [docs/product/roadmap.md](docs/product/roadmap.md).

## Contributing

Contributions are welcome — bug reports, ideas, docs and code. Start with
[CONTRIBUTING.md](CONTRIBUTING.md), and look for issues labelled
[`good first issue`](https://github.com/omer-gh/sourceglance/labels/good%20first%20issue).

- Developer setup: [docs/development.md](docs/development.md)
- Release process: [RELEASING.md](RELEASING.md)
- Security reports: [SECURITY.md](SECURITY.md)

Everyone taking part must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 Mohammad Omer

sourceglance is not affiliated with or endorsed by GitHub, Inc.
