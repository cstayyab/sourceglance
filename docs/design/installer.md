# Installer wizard — design

An MSI-style setup wizard: download one file from
[GitHub Releases](https://github.com/omer-gh/sourceglance/releases), double-click it, and
click **Next** through a native window with a license page, a progress bar and a Finish
page. No app store, apt repository, snap, terminal or developer tools. Running it again
offers **Repair** or **Remove**, like *Programs and Features* on Windows.

Requirement IDs (I1–I12) refer to the [roadmap](../product/roadmap.md#installer-direct-download).
The technology choice is recorded in [ADR 0005](../adr/0005-self-contained-installer.md).

## What the user downloads

| Release asset | Purpose |
|---------------|---------|
| `sourceglance-Setup-X.Y.Z-x86_64.AppImage` | **The installer** for most PCs (Intel/AMD). |
| `sourceglance-Setup-X.Y.Z-aarch64.AppImage` | The installer for ARM PCs. |
| `sourceglance@omer-gh.github.io.shell-extension.zip` | The plain extension, for manual installs. |
| `SHA256SUMS` | Checksums of every file. |
| Build provenance attestation | Proof the files were built by this repo's release workflow (`gh attestation verify`). |

The AppImage contains only the wizard (GJS code), the extension zip and the license — about
1 MB. It draws its window with the GJS, GTK 4 and libadwaita that every GNOME Shell 46+
desktop already has, so nothing is bundled or downloaded.

## Starting it (I1)

Linux, like Windows SmartScreen, won't run a downloaded program until you allow it once:

1. Open **Downloads** in Files.
2. Right-click `sourceglance-Setup-0.1.0-x86_64.AppImage` → **Properties** → turn on
   **Executable as Program**.
3. Double-click the file. The setup window opens.

The README shows this with screenshots, plus an optional verification step (checksum or
attestation) before step 2. Advanced users can run the same file from a terminal.

## Window layout

A fixed-size libadwaita window (about 640 × 480), titled **sourceglance Setup**, with the
classic wizard frame:

```
┌──────────────────────────────────────────────────────────────┐
│  sourceglance Setup                                        ✕    │
├──────────────────────────────────────────────────────────────┤
│  License Agreement                                    [icon] │  page title
│  Please read the following license carefully.                │  page subtitle
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                     page content                             │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  Step 2 of 6                    [ < Back ] [ Next > ] [Cancel]│  button bar
└──────────────────────────────────────────────────────────────┘
```

- **Next** is the default button (Enter) and is disabled until the page is complete.
- **Cancel** asks "Exit sourceglance Setup? Nothing has been changed." until installation
  starts; during installation it is disabled.
- Keyboard: mnemonics (`_Back`, `_Next`), Tab order top to bottom, Escape = Cancel.
  Screen readers get page titles and control labels (I11).

## Install flow (I2)

```
Welcome ─▶ License ─▶ Before you install ─▶ Options ─▶ System check ─▶ Ready ─▶ Installing ─▶ Completed
                                                                                    └─▶ Setup failed (rolled back)
```

### 1. Welcome

"**Welcome to the sourceglance 0.1.0 Setup Wizard.** Setup will install sourceglance, which
shows your GitHub issues in the top bar. Click Next to continue." If an older version is
installed: "Setup will upgrade sourceglance 0.0.9 to 0.1.0."

### 2. License Agreement (I3)

- Banner above the text: **"sourceglance is provided AS IS, without warranty of any kind. You
  use it at your own risk."**
- Scrollable, read-only view of the full MIT License, plus a **View online** link to
  <https://github.com/omer-gh/sourceglance/blob/main/LICENSE>.
- Two radio buttons, MSI style; the second is selected by default:
  - ( ) **I accept the terms in the License Agreement**
  - (•) **I do not accept the terms in the License Agreement**
- **Next** is enabled only when "I accept" is selected.

### 3. Before you install

Plain-language risks: pre-release software; extensions run inside your desktop and a bug
can freeze it; installs only for your account (no admin password); what it changes
(below); your GitHub token, if you add one later, stays in your GNOME keyring and is sent
only to GitHub.

### 4. Setup Options

| Option | Default | Notes |
|--------|---------|-------|
| Install for | **Only for me** | "Everyone on this computer" shown disabled: *not supported yet* |
| Location | `~/.local/share/gnome-shell/extensions/sourceglance@omer-gh.github.io` | Read-only; this is where GNOME looks |
| ☑ Turn on sourceglance after installation | on | Adds it to the enabled extensions |
| ☐ Reset sourceglance settings from a previous installation | off | Shown only if settings exist |

### 5. System Check (I4)

Runs automatically and lists each check with ✓ / ✗, like a prerequisites page. **Next**
stays disabled while any check fails.

| Check | Failure text | Fix button |
|-------|--------------|-----------|
| Not running as administrator | "Run Setup as your normal user. sourceglance installs only for you." | — |
| GNOME Shell version supported | "sourceglance 0.1.0 supports GNOME Shell 46–50. You have 45." | — |
| Package integrity | "The setup file is damaged. Download it again." | — |
| User extensions allowed | "User extensions are turned off." | **Turn On** |
| Disk space | "Not enough free space." | — |

### 6. Ready to Install

A summary of exactly what will happen, then **Install** in place of **Next**:

- Copy sourceglance 0.1.0 to `~/.local/share/gnome-shell/extensions/…`
- Turn on sourceglance for your next login
- (if upgrading) Replace sourceglance 0.0.9; your settings and saved token are kept

### 7. Installing

- Progress bar with the current step: *Verifying package… → Backing up previous version…
  → Copying files… → Turning on sourceglance… → Cleaning up…*
- **Show details** expander with a log, also saved to
  `~/.cache/sourceglance-setup/setup.log`.
- **Rollback (I8):** the previous version is backed up first. If any step fails, Setup
  restores it, then shows *Setup failed*.

### 8. Completed

"**sourceglance 0.1.0 has been installed.** Log out and back in to start it. Then click the
sourceglance icon in the top bar and choose **Settings** to sign in."

- ☐ **Log out now** (when ticked, clicking **Finish** first asks: "Save your work first —
  open apps will close.")
- **Finish**

### Setup failed

"Setup couldn't install sourceglance. Your previous version was restored." Shows the reason,
the log location, and a **Report a problem** link to the bug report form.

## Maintenance mode (I7, I9)

When sourceglance is already installed, Setup opens on **Program Maintenance** instead of
Welcome:

| Installed | Choices |
|-----------|---------|
| Same version | ( ) **Repair** — reinstall the files · ( ) **Remove** — uninstall sourceglance |
| Older version | Normal flow as an **Upgrade** (Welcome text changes) |
| Newer version | Warning "A newer version (0.2.0) is installed." · ( ) **Downgrade** · ( ) **Remove** |

**Remove** flow: *Remove options* → *Ready to Remove* → progress → *Removed*. Options,
both **off** by default:

- ☐ Also delete my saved GitHub token from the keyring
- ☐ Also reset sourceglance settings

sourceglance also appears in GNOME's **Extensions** app (the Linux equivalent of *Programs and
Features*), where it can be turned off or removed without Setup.

## Command-line use (I10)

The same file works from a terminal, like `msiexec`:

| Option | Effect |
|--------|--------|
| `--quiet --accept-license` | Unattended install with defaults; prints the license; still refuses root and runs every check |
| `--repair`, `--uninstall` | Maintenance actions (add `--quiet` for unattended) |
| `--check` | Run the system check only |
| `--extract DIR` | Write the embedded extension zip to `DIR` for inspection |
| `--log FILE` | Write the log somewhere else |
| `--version`, `--help` | Info |

Exit codes: `0` success, `1` failed check or error, `2` bad usage, `3` cancelled by the
user. If FUSE is unavailable, `--appimage-extract-and-run` works as a fallback.

## Out of scope

- System-wide installs, `.deb`, snap or Flatpak packages.
- Automatic updates (a "check for updates" link may come later).
- Embedded AppImage GPG signatures (planned after v0.1.0; checksums and attestations come
  first).
- Non-GNOME desktops. Other distros with GNOME Shell 46+ work on a best-effort basis.
