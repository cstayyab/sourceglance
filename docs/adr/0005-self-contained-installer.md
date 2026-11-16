# 0005. Ship an MSI-style setup wizard as an AppImage using the system's GJS and libadwaita

- **Status:** Proposed
- **Date:** 2026-11-16

## Context

Until sourceglance is on extensions.gnome.org (v1.0), installing means cloning the repo and
running `make install`. We want an experience like a Windows MSI: download one file,
double-click it, step through a windowed wizard (license, options, progress, finish), and
run it again later to repair or remove — no app store, apt repository, snap or terminal.

Constraints on Ubuntu:

- GNOME Shell extensions are installed per user by unpacking a zip into
  `~/.local/share/gnome-shell/extensions/` (`gnome-extensions install`); no root needed.
- Since GNOME 43, the Files app never runs scripts on double-click. It does run a
  downloaded **program** once the user turns on *Executable as Program* (the equivalent of
  SmartScreen's "Run anyway").
- Every GNOME Shell 46+ system already has GJS, GTK 4 and libadwaita (GNOME Shell and its
  extension preferences depend on them), and Ubuntu installs FUSE 3 by default.

## Options considered

1. **AppImage containing a GJS/libadwaita wizard** — one double-clickable file. The
   AppImage carries only our JavaScript, the extension zip and the license (~1 MB) and uses
   the system's GJS/GTK/libadwaita, which every target system has. Native GNOME look, same
   language as the extension, testable. Needs the one-time *Executable as Program* toggle.
2. **Self-extracting shell script + `zenity` dialogs** (the previous draft) — tiny and easy to
   audit, but a chain of separate dialogs rather than one wizard window, and it needs a
   terminal command to start. Doesn't meet the MSI-style requirement.
3. **Downloadable `.deb`** — true double-click, but it opens App Center, installs
   system-wide and needs an admin password: the app-store/apt route we want to avoid.
4. **AppImage bundling its own GTK/Python or Electron** — 30–150 MB for a tiny job, harder to
   audit, and duplicates libraries the system already has.
5. **Flatpak bundle** — opens App Center, and the sandbox can't write to the extensions
   directory without broad permissions.

## Decision

Option 1. Ship `sourceglance-Setup-X.Y.Z-<arch>.AppImage` (x86_64 and aarch64). Its `AppRun`
starts `gjs -m` on the wizard in `tools/installer/`. The wizard is an `Adw.ApplicationWindow`
with Back/Next/Cancel pages, maintenance mode (Repair/Remove), rollback on failure, and a
command-line mode for unattended use.

The release workflow builds it with a **pinned, checksum-verified** AppImage runtime and
`appimagetool`, and publishes it with `SHA256SUMS` and a GitHub build provenance
attestation.

## Consequences

- MSI-like experience: one file, a familiar wizard window, repair/remove later.
- Small and auditable: `--appimage-extract` (or `--extract DIR` for just the payload) shows
  every file, and the code is plain JavaScript in this repo.
- The wizard is code users run, so it gets the same rigour as the extension: pure logic in a
  Node-tested module, ESLint, an install/upgrade/repair/remove test in an isolated headless
  session in CI, and threat model entries T14–T19.
- Users must turn on *Executable as Program* once; the README explains it with screenshots.
- Depending on system libraries means the wizard must stick to APIs available in the oldest
  supported release (GNOME 46: GTK 4.14, libadwaita 1.5).
- Supersedes the earlier zenity-script draft of this ADR (never accepted).
