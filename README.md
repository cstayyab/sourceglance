# sourceglance

**Your GitHub issues and project boards, one click away in the Ubuntu top bar.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Lint](https://github.com/omer-gh/sourceglance/actions/workflows/lint.yml/badge.svg)](https://github.com/omer-gh/sourceglance/actions/workflows/lint.yml)
[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-46--50-4a86cf)](src/metadata.json)

sourceglance is a GNOME Shell extension for Ubuntu Desktop. It puts a small indicator in the
top bar; click it to see the issues assigned to you and the cards on your GitHub Projects,
without opening a browser.

> **Status: early development.** v0.1.0 (assigned issues) is in progress; Projects boards
> come next. See the [roadmap](#roadmap) and the open issues if you want to help.

## Features

- [x] Top-bar indicator with a count of your open assigned issues
- [x] Sign in with a GitHub personal access token (stored in the GNOME keyring)
- [x] List issues assigned to you, grouped by repository, with auto-refresh
- [x] Filter to specific repositories; open any issue in the browser with one click
- [ ] Show GitHub Projects (v2) columns and cards
- [ ] Desktop notifications for new assignments

## Requirements

- Ubuntu 24.04 LTS or newer (or any distro with GNOME Shell 46–50)
- A GitHub account

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

### From extensions.gnome.org

Coming with the first stable release.

## Usage

1. [Create a fine-grained token](https://github.com/settings/personal-access-tokens/new)
   with read-only **Issues** and **Metadata** access to the repositories you care about.
2. Click the sourceglance icon in the top bar and choose **Settings**.
3. Paste the token into **Personal access token** and press the apply button. Settings
   shows "Signed in as @you".
4. Optionally list repositories to watch (`owner/name, owner/other`); leave it empty to see
   everything assigned to you.
5. Click the icon to see your issues; click any issue to open it in your browser.

## Roadmap

| Milestone | Goal |
|-----------|------|
| `v0.1.0` | Token sign-in and assigned-issues list |
| `v0.2.0` | GitHub Projects (v2) board view |
| `v0.3.0` | Notifications and unread badge |
| `v1.0.0` | Published on extensions.gnome.org |

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
