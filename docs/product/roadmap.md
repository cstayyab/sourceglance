# Roadmap

Each release maps to a [GitHub milestone](https://github.com/omer-gh/sourceglance/milestones).
Scope can move between milestones during planning; the milestone is the source of truth.

## v0.1.0 — "Assigned to me" (MVP)

**Outcome:** a user can sign in with a token and see their open assigned issues in the top
bar.

| # | Requirement | Acceptance criteria |
|---|-------------|---------------------|
| R1 | Token sign-in | User pastes a fine-grained token in Settings; it's validated against GitHub and saved to the GNOME keyring; Settings shows "Signed in as @login". |
| R2 | Sign out | One button removes the token from the keyring; the menu returns to the signed-out state. |
| R3 | Assigned issues list | Menu lists open issues assigned to the user, grouped by repository, newest update first, up to 25 items, plus a "View all on GitHub" link. |
| R4 | Repository filter | If repositories are set in Settings, only their issues are shown. |
| R5 | Open in browser | Clicking an issue opens it in the default browser and closes the menu. |
| R6 | Count badge | The top-bar icon shows the number of open assigned issues (hidden when 0 or signed out). |
| R7 | Refresh | Auto-refresh on the configured interval (default 10 min), plus a manual **Refresh** item. |
| R8 | Clear states | Distinct menu states for signed out, loading, empty, and error (invalid token, rate limited, offline). |
| R9 | Clean lifecycle | Enabling/disabling 10 times leaves no errors, timers, or panel items behind. |

### Installer (direct download)

**Outcome:** anyone can install sourceglance by downloading one file from GitHub Releases and
following a graphical wizard — no app store, apt/snap repository or developer tools.
Design: [installer wizard](../design/installer.md), [ADR 0005](../adr/0005-self-contained-installer.md).

| # | Requirement | Acceptance criteria |
|---|-------------|---------------------|
| I1 | Single-file download | `sourceglance-installer-X.Y.Z.sh` on each GitHub Release contains everything; installs with no network access. |
| I2 | Graphical wizard | Welcome → risks → license → system check → install → finish, using `zenity`; falls back to terminal prompts without a display. |
| I3 | Risks and license | Risks listed before any change; the user must tick "I accept the MIT License … NO WARRANTY" (with a link) to continue; Cancel changes nothing. |
| I4 | System check | Clear message and no changes when: run as root, unsupported GNOME Shell version, damaged file, or user extensions disabled. |
| I5 | User-level install | No sudo or admin password; touches only the user's extension directory and `enabled-extensions`. |
| I6 | Integrity | Installer verifies its embedded checksum; releases publish `SHA256SUMS` and a build provenance attestation; README explains how to verify. |
| I7 | Upgrades | Detects an installed version and offers Upgrade / Reinstall / Downgrade (with a warning). |
| I8 | Finish | Extension loads at next login; **Log Out Now** asks the user to save work first; next steps explain signing in. |
| I9 | Uninstall | `--uninstall` or Welcome screen removes the extension; removing the token and settings are separate opt-in checkboxes. |
| I10 | Scriptable | `--accept-license`, `--no-gui`, `--check`, `--extract`; documented exit codes. |
| I11 | Built and tested by CI | Release workflow builds the installer; CI runs shellcheck and an install/upgrade/uninstall test in an isolated headless session. |

**Out of scope:** Projects boards, notifications, caching across restarts, `.deb`/snap/Flatpak
packages, automatic updates.

## v0.2.0 — Project boards

- Pick one or more GitHub Projects (v2), user or org owned.
- Show columns (Status field) with card counts; expand a column to list its cards.
- Requires the GraphQL API (see [ADR 0003](../adr/0003-rest-search-api-for-issues.md)).

## v0.3.0 — Stay informed

- Optional desktop notification when a new issue is assigned.
- "Unread" highlight for issues updated since you last opened the menu.
- Translations (gettext) and first community translations.

## v1.0.0 — Stable

- Accessibility and keyboard navigation review.
- Published on extensions.gnome.org.
- Support policy: current Ubuntu LTS's GNOME Shell through the latest release.
