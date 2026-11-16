# sourceglance

**Your GitHub issues and project boards, one click away in the Ubuntu top bar.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Lint](https://github.com/omer-gh/sourceglance/actions/workflows/lint.yml/badge.svg)](https://github.com/omer-gh/sourceglance/actions/workflows/lint.yml)
[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-46--50-4a86cf)](src/metadata.json)

sourceglance is a GNOME Shell extension for Ubuntu Desktop. It puts a small indicator in the
top bar; click it to see the issues assigned to you and the cards on your GitHub Projects,
without opening a browser.

> **Status: early development.** The panel indicator works, but GitHub data isn't wired up
> yet. See the [roadmap](#roadmap) and the open issues if you want to help.

## Features

- [x] Top-bar indicator with a dropdown menu
- [x] Settings window (refresh interval, repositories to watch)
- [ ] Sign in with a GitHub personal access token (stored in the GNOME keyring)
- [ ] List issues assigned to you, grouped by repository
- [ ] Show GitHub Projects (v2) columns and cards
- [ ] Unread badge and desktop notifications for new assignments
- [ ] Open any issue or card in the browser with one click

## Requirements

- Ubuntu 24.04 LTS or newer (or any distro with GNOME Shell 46–50)
- A GitHub account

## Installation

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

### Setup wizard (planned for v0.1.0)

Download `sourceglance-Setup-X.Y.Z-x86_64.AppImage` from
[Releases](https://github.com/omer-gh/sourceglance/releases), allow it to run once
(**Properties → Executable as Program**), and double-click it. A setup wizard walks you
through the license, a system check and the install — no admin password, app store or
apt/snap repository needed. Run it again later to repair or remove sourceglance. See the
[installer design](docs/design/installer.md).

### From extensions.gnome.org

Coming with the first stable release.

## Usage

1. Click the sourceglance icon in the top bar.
2. Open **Settings** from the menu to choose which repositories to watch.
3. Click any issue to open it in your browser.

## Roadmap

| Milestone | Goal |
|-----------|------|
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
