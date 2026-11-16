# Installer wizard — design

Lets anyone install sourceglance by downloading one file from
[GitHub Releases](https://github.com/omer-gh/sourceglance/releases), with no app store, apt
repository, snap or extensions.gnome.org account. Requirement IDs (I1–I11) refer to the
[roadmap](../product/roadmap.md#installer-direct-download). The technical choice is
recorded in [ADR 0005](../adr/0005-self-contained-installer.md).

## What the user downloads

| Release asset | Purpose |
|---------------|---------|
| `sourceglance-installer-X.Y.Z.sh` | **The installer.** One self-contained file: the wizard plus the extension, so it works offline. |
| `sourceglance@omer-gh.github.io.shell-extension.zip` | The plain extension, for manual installs. |
| `SHA256SUMS` | Checksums of both files. |
| Build provenance attestation | Proof the files were built by this repo's release workflow (`gh attestation verify`). |

## Starting it

Since GNOME 43, the Files app no longer runs scripts on double-click, so users start the
installer with one command; everything after that is graphical:

```bash
bash ~/Downloads/sourceglance-installer-0.1.0.sh
```

The README also shows an optional verification step first (checksum or attestation).
We never recommend `curl … | bash`.

## Wizard flow (graphical, `zenity`)

`zenity` ships with every Ubuntu desktop, so no extra install is needed.

```
 Welcome ─▶ Before you continue ─▶ License ─▶ System check ─▶ Installing ─▶ Finish
    │            (risks)          (must tick)   (can stop)                 (log out?)
    └─▶ Uninstall (if already installed)
```

### 1. Welcome

- Title: **Install sourceglance 0.1.0**. One line on what it does.
- Detects an existing install and adjusts the main action:

  | Found | Main action | Note shown |
  |-------|-------------|------------|
  | Nothing | **Install** | — |
  | Older version | **Upgrade from 0.0.9** | — |
  | Same version | **Reinstall** | — |
  | Newer version | **Downgrade from 0.2.0** | "Downgrading may lose settings added in newer versions." |

- If installed, a secondary **Uninstall** action ([Uninstall](#uninstall)).

### 2. Before you continue (risks)

A plain-language list, then **Continue** / **Cancel**:

- sourceglance is pre-release software.
- Extensions run inside your desktop; a bug can freeze or crash your session.
- It installs **only for your user account** — no administrator password.
- Changes: copies files to `~/.local/share/gnome-shell/extensions/sourceglance@omer-gh.github.io`
  and turns the extension on for your next login. Nothing else.
- Your GitHub token, if you add one later, is kept in your GNOME keyring and sent only to
  GitHub.

### 3. License (I3)

- `zenity --text-info` showing the full MIT License, with a link to
  <https://github.com/omer-gh/sourceglance/blob/main/LICENSE>.
- A checkbox the user must tick before **Next** becomes clickable:
  **"I accept the MIT License, including that sourceglance comes with NO WARRANTY and I use it
  at my own risk."**
- **Cancel** quits without changing anything.

### 4. System check (I4)

Each check shows ✓ or a specific message. Any failure stops the wizard before anything is
changed.

| Check | Failure message |
|-------|-----------------|
| Not running as root | "Run the installer as your normal user, without sudo. sourceglance installs only for you." |
| GNOME Shell present and version in `metadata.json` `shell-version` | "sourceglance 0.1.0 supports GNOME Shell 46–50. You have 45." |
| Installer integrity (embedded SHA-256 of the payload) | "The installer file is damaged. Download it again." |
| User extensions allowed (`org.gnome.shell disable-user-extensions` is false) | "User extensions are turned off. Turn on **Extensions** in the Extensions app and run the installer again." (offer to turn it on) |
| Enough disk space in `~/.local/share` | "Not enough disk space." |

### 5. Installing

A pulsating progress dialog while it runs `gnome-extensions install --force` with the
embedded zip, then confirms the files are in place and adds the extension to
`enabled-extensions` so it loads at next login.

### 6. Finish (I8)

- **Wayland** (Ubuntu default): GNOME Shell only loads new or updated extensions after you
  log in again.
  - Text: "sourceglance is installed. Log out and back in to start it. After that, click the
    sourceglance icon in the top bar and choose **Settings** to sign in."
  - Buttons: **Log Out Now** (asks once more: "Save your work first — open apps will
    close.") and **Later**.
- **X11** (older releases): same text; no log-out needed if the Shell already picked it up.

## Uninstall

Reached from Welcome or with `--uninstall`.

- Confirmation dialog listing what will be removed: the extension files.
- Two optional checkboxes, **both off by default**:
  - "Also remove my saved GitHub token from the keyring"
  - "Also reset sourceglance settings"
- Runs `gnome-extensions uninstall`, then the selected extras, then suggests logging out.

## Terminal mode and options (I2, I10)

If there is no graphical session or `zenity` is missing, the same steps run as text
prompts (`whiptail` when available, plain prompts otherwise). The license step requires
typing **I agree**.

| Option | Effect |
|--------|--------|
| `--no-gui` | Force terminal mode |
| `--uninstall` | Go straight to uninstall |
| `--check` | Run the system check only; change nothing |
| `--extract DIR` | Write the embedded extension zip to `DIR` for inspection; change nothing |
| `--accept-license` | Unattended install for scripts. Prints the license and records acceptance; still refuses root and still runs every check |
| `--version`, `--help` | Info |

Exit codes: `0` success, `1` failed check or error, `2` bad usage, `3` cancelled by the user.

## Out of scope

- System-wide installs, `.deb`, snap or Flatpak packages.
- Automatic updates (a "check for updates" link may come later).
- Non-GNOME desktops. Other distros with GNOME Shell 46+ and bash work on a best-effort
  basis.
