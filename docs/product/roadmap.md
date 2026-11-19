# Roadmap

Each release maps to a [GitHub milestone](https://github.com/omer-gh/sourceglance/milestones).
Scope can move between milestones during planning; the milestone is the source of truth.

## v0.1.0 — "Assigned to me" (MVP)

**Outcome:** a user can sign in with a token and see their open assigned issues in the top
bar.

| # | Requirement | Acceptance criteria |
| --- | ------------- | --------------------- |
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

**Outcome:** anyone can install sourceglance like a Windows MSI: download one file from GitHub
Releases, double-click it, and click through a setup wizard — no app store, apt/snap
repository, terminal or developer tools.
Design: [installer wizard](../design/installer.md), [ADR 0005](../adr/0005-self-contained-installer.md).

| # | Requirement | Acceptance criteria |
| --- | ------------- | --------------------- |
| I1 | Double-click setup file | `sourceglance-Setup-X.Y.Z-<arch>.AppImage` (x86_64, aarch64) on each release; after the one-time *Executable as Program* toggle, double-clicking opens the wizard. Works offline. |
| I2 | Wizard window | One window with Back / Next / Cancel: Welcome → License → Before you install → Options → System check → Ready → Installing → Completed. |
| I3 | License agreement | Full Apache 2.0 text, "AS IS / no warranty / at your own risk" banner, online link; Next enabled only after selecting "I accept" (default is "I do not accept"). |
| I4 | System check | ✓/✗ list; blocks on: administrator, unsupported GNOME Shell, damaged package, user extensions off (with **Turn On** fix), low disk space. |
| I5 | User-level install | No admin password; touches only the user's extension directory and enabled-extensions setting; Ready page lists every change. |
| I6 | Integrity | Embedded payload checksum verified; releases publish `SHA256SUMS` and a build provenance attestation; README explains verification. |
| I7 | Maintenance mode | Re-running offers Repair / Remove (same version), Upgrade (older installed), Downgrade with warning (newer installed). |
| I8 | Progress and rollback | Progress bar with steps and a details log; previous version backed up and restored if anything fails. |
| I9 | Remove | Removes the extension; deleting the saved token and resetting settings are separate opt-in options. |
| I10 | Command line | `--quiet --accept-license`, `--repair`, `--uninstall`, `--check`, `--extract`, `--log`; documented exit codes. |
| I11 | Accessible | Full keyboard operation, mnemonics, default button, screen-reader labels. |
| I12 | Built and tested by CI | Release workflow builds both AppImages with pinned, checksum-verified tools; CI tests install/upgrade/repair/remove headlessly and lints the wizard. |

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
