# 0001. Build sourceglance as a GNOME Shell extension

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Ubuntu Desktop uses GNOME Shell. We want an always-visible, one-click view of GitHub work.
GNOME has no system tray by default; Ubuntu adds AppIndicator support through a bundled
extension, but other GNOME distros don't.

## Options considered

1. **GNOME Shell extension (GJS)** — native top-bar indicator and menu, distributed through
   extensions.gnome.org. Must be careful: code runs inside the Shell process, and each GNOME
   release can break APIs.
2. **Standalone GTK4/libadwaita app with an AppIndicator** — isolated process, any language.
   Depends on the AppIndicator extension, and a tray icon with a separate window feels less
   integrated.
3. **Standalone app window only** — simplest, but not glanceable.

## Decision

Build a GNOME Shell extension in JavaScript (GJS, ES modules), targeting GNOME Shell 46+
(Ubuntu 24.04 LTS onward).

## Consequences

- Native look and one-click access; easy install from extensions.gnome.org.
- We must follow the extension review guidelines: no blocking I/O, full cleanup in
  `disable()`, no bundled binaries.
- We need a compatibility release for each new GNOME Shell version (see RELEASING.md).
