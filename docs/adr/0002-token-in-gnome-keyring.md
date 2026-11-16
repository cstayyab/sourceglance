# 0002. Store the GitHub token in the GNOME keyring

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

sourceglance needs a GitHub credential. Anything stored in GSettings is readable with
`dconf dump /` by any process running as the user and often ends up in backups and
dotfile repos.

## Options considered

1. **GSettings string** — trivial, but plain text.
2. **GNOME keyring via libsecret** — encrypted at rest, unlocked with the user's login,
   standard for GNOME apps. Available in both the Shell and prefs processes through
   `gi://Secret`.
3. **OAuth device flow** — no copy-pasting tokens, but needs a registered OAuth app and
   still needs somewhere to store the resulting token.

## Decision

Users paste a fine-grained personal access token in Settings. It's stored in the keyring
with libsecret, under schema `io.github.omer-gh.sourceglance` with attribute
`{account: "github.com"}`.

## Consequences

- No secrets in GSettings, dconf or logs.
- If the keyring is locked or unavailable, the extension shows the signed-out state.
- OAuth device flow can be added later as a nicer sign-in that stores into the same entry.
