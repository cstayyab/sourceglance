# Development setup

## Prerequisites

```bash
sudo apt install gnome-shell-extension-prefs zip make nodejs npm
```

Then install the lint tooling once:

```bash
npm install
```

## Project layout

```
src/
├── extension.js      # Lifecycle and refresh loop: created in enable(), destroyed in disable()
├── prefs.js          # Settings window (libadwaita): token sign-in, filters
├── lib/
│   ├── indicator.js  # Panel button and menu (pure view: render(state))
│   ├── github.js     # GitHub REST client (Soup 3)
│   ├── tokenStore.js # Token in the GNOME keyring (libsecret)
│   └── model.js      # Pure logic, no GNOME imports, unit-tested with Node
├── metadata.json     # UUID, name, supported GNOME Shell versions
├── stylesheet.css    # Styles for the panel menu
└── schemas/          # GSettings schema (non-secret settings only)
tests/                # Node unit tests for lib/model.js
tools/shell-smoke.sh  # Headless GNOME Shell enable/disable smoke test
```

See [architecture.md](architecture.md) for how the pieces fit together.

## Tests

```bash
make test        # unit tests for src/lib/model.js (Node 20+)
```

```bash
make smoke       # enable/disable 10× in an isolated headless GNOME Shell
```

`make smoke` runs its own D-Bus session with in-memory settings, so it doesn't touch your
desktop. It checks the extension loads and unloads cleanly in the signed-out state; test
the signed-in flow by hand in a nested session (below) with your own token.

## Preview script (recommended)

`tools/preview.sh` handles the one-time setup and starts a preview:

```bash
./tools/preview.sh
```

```bash
./tools/preview.sh --session
```

| Mode | What it does | Use it for |
|------|--------------|------------|
| default (`--nested`) | Starts a second GNOME Shell in a window and enables sourceglance there. Its settings live in `~/.cache/sourceglance-preview`, so your real session isn't changed. | Checking the menu, states and settings UI safely |
| `--session` | Installs and enables sourceglance in your real desktop session | Testing sign-in (the nested session can't reach your keyring) |

Before doing anything, the script explains the risks, shows the MIT License and its
no-warranty terms, and asks you to type **I agree**. It installs missing packages
(`mutter-dev-bin` on GNOME 49+) with `sudo apt install` only after asking. Run
`./tools/preview.sh --help` for all options.

## Setup wizard (installer)

The MSI-style installer lives in `tools/installer/` (design:
[installer.md](design/installer.md); user guide: [installing.md](installing.md)).

| Command | What it does |
|---------|--------------|
| `make setup-run` | Stage the payload and open the wizard from source. **It really installs** into your account; pass `ARGS=--check` to only run the checks. |
| `make setup-test` | Command-line install / upgrade / repair / remove test in an isolated home |
| `make setup` | Build `dist/sourceglance-Setup-<version>-{x86_64,aarch64}.AppImage` (needs `squashfs-tools`; downloads the pinned AppImage runtime and verifies its SHA-256) |

Decision logic is in `tools/installer/lib/plan.js` (no GNOME imports, tested by
`tests/setup-plan.test.js`). `tests/setup-screenshots.js` renders every page to PNG when
run inside a headless GNOME Shell with isolated `HOME`/`XDG_*` directories; use it to
refresh `docs/images/setup-*.png`. Keep the wizard to GTK 4.14 / libadwaita 1.5 APIs so it
runs on GNOME 46.

## Run it locally by hand

```bash
make install     # compiles schemas and copies src/ to ~/.local/share/gnome-shell/extensions/
```

On **Wayland** (the Ubuntu default) you can't restart GNOME Shell in place. Test in a
nested session instead, so a crash doesn't take down your desktop:

```bash
# GNOME Shell 49+
dbus-run-session gnome-shell --devkit
# GNOME Shell 46–48
dbus-run-session -- gnome-shell --nested --wayland
```

Inside the nested session, open a terminal and run:

```bash
gnome-extensions enable sourceglance@omer-gh.github.io
```

On **X11**, press <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r`, and press Enter to reload.

## Debugging

- Extension logs: `journalctl -f -o cat /usr/bin/gnome-shell`
- Preferences logs: `journalctl -f -o cat /usr/bin/gjs`
- Open the settings window: `gnome-extensions prefs sourceglance@omer-gh.github.io`
- Looking Glass inspector: <kbd>Alt</kbd>+<kbd>F2</kbd>, then `lg`

## Before opening a PR

```bash
make lint
```

```bash
make test
```

```bash
make smoke
```

```bash
make pack        # builds dist/sourceglance@omer-gh.github.io.shell-extension.zip
```

Then check that enabling and disabling the extension several times leaves no errors in the
log and no leftover icons in the panel.
