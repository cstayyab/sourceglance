# 0004. Keep core logic in a pure module tested with Node

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

GNOME Shell code is hard to test automatically: `resource:///org/gnome/shell/...` imports
only resolve inside a running Shell. Bugs in query building, grouping or error handling
would only show up by hand.

## Options considered

1. **Manual testing only** — no tooling, but regressions slip through.
2. **Run tests inside a headless GNOME Shell** — realistic, but slow and complex in CI.
3. **Pure core module** — put all logic that doesn't need GNOME APIs in `lib/model.js` with
   no `gi://` or `resource://` imports, and test it with Node's built-in `node:test`.

## Decision

Option 3. UI and I/O modules stay thin; anything with branches or parsing goes in
`lib/model.js`. CI runs `npm test` on every PR. A headless Shell smoke test (enable,
disable, check the log) is documented for manual runs.

## Consequences

- Fast, dependency-free unit tests.
- Contributors must keep `model.js` free of GNOME imports; lint and review enforce it.
