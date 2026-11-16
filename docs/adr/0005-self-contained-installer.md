# 0005. Ship a self-contained installer script with a zenity wizard

- **Status:** Proposed
- **Date:** 2026-11-16

## Context

Until sourceglance is on extensions.gnome.org (v1.0), installing means cloning the repo and
running `make install`. We want anyone to install it by downloading one file from GitHub
Releases, with a guided, graphical flow — no app store, apt repository or snap.

GNOME Shell extensions are installed per user by unpacking a zip into
`~/.local/share/gnome-shell/extensions/` (`gnome-extensions install`), so no root access is
needed.

## Options considered

1. **Self-extracting shell script + `zenity` dialogs** — one file containing a small bash
   wizard and the extension zip (base64). `zenity`, `bash` and `gnome-extensions` ship with
   every Ubuntu desktop. Easy to audit (it's text), works offline, no root. Downside: needs
   one terminal command to start, because the Files app won't run scripts on double-click.
2. **Downloadable `.deb`** — double-click opens App Center. But it installs system-wide,
   needs an admin password, and is the apt route the request wants to avoid.
3. **AppImage / GTK wizard app** — polished UI, but a large binary for a tiny job, needs
   FUSE, and is much harder to audit than a script.
4. **Flatpak** — the sandbox can't write to the extensions directory without broad holes.
5. **Zip + written instructions** — simplest, but not a wizard and easy to get wrong.

For option 1 we could use the `makeself` tool, but a ~30-line packer of our own
(`tools/build-installer.sh`) avoids a build dependency and keeps the format obvious.

## Decision

Option 1. The release workflow builds `sourceglance-installer-X.Y.Z.sh` from
`tools/installer/installer.sh` (the wizard) plus the extension zip, embeds the payload's
SHA-256, and publishes it with `SHA256SUMS` and a GitHub build provenance attestation.

## Consequences

- One-file, offline, no-root install that is reviewable in a text editor.
- The installer is code that users run, so it gets the same rigour as the extension:
  shellcheck, tests in an isolated headless session in CI, and threat model entries
  (T14–T18).
- Users need one terminal command to start; the README makes it copy-pasteable.
- Must keep working on both `zenity` 3.x and 4.x and fall back to terminal prompts.
