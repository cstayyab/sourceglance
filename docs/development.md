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
├── extension.js      # Panel indicator: created in enable(), destroyed in disable()
├── prefs.js          # Settings window (libadwaita)
├── metadata.json     # UUID, name, supported GNOME Shell versions
├── stylesheet.css    # Styles for the panel menu
└── schemas/          # GSettings schema (non-secret settings only)
```

## Run it locally

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
make pack        # builds dist/sourceglance@omer-gh.github.io.shell-extension.zip
```

Then check that enabling and disabling the extension several times leaves no errors in the
log and no leftover icons in the panel.
