# Architecture

sourceglance is a GNOME Shell extension (see [ADR 0001](adr/0001-gnome-shell-extension.md)).
It runs in two processes that share code under `src/lib/`:

- **Shell process** — `extension.js` runs inside `gnome-shell`. It owns the panel
  indicator and the refresh loop. A crash or blocking call here freezes the desktop, so
  everything is async and every resource is released in `disable()`.
- **Preferences process** — `prefs.js` runs in a separate `gjs` process when the user opens
  Settings. It validates and stores the token.

```
 ┌──────────────────────── gnome-shell process ────────────────────────┐
 │                                                                     │
 │  extension.js  ──owns──▶  Indicator (lib/indicator.js)              │
 │       │                       ▲  render(state)                      │
 │       │ timer / settings      │                                     │
 │       ▼                       │                                     │
 │  refresh() ──▶ TokenStore ──▶ GitHubClient ──▶ model.js             │
 │               (lib/tokenStore) (lib/github)    (pure: query,        │
 │                    │               │            grouping, errors)   │
 └────────────────────┼───────────────┼────────────────────────────────┘
                      ▼               ▼
              GNOME keyring     api.github.com
              (libsecret)       (HTTPS, Soup 3)
                      ▲               ▲
 ┌────────────────────┼───────────────┼──── gjs prefs process ─────────┐
 │  prefs.js ──▶ TokenStore      GitHubClient.getViewer()  (validate)  │
 └─────────────────────────────────────────────────────────────────────┘
          both read/write non-secret settings via GSettings
```

## Modules

| Module | Responsibility | Depends on |
|--------|----------------|------------|
| `extension.js` | Lifecycle (`enable`/`disable`), refresh timer, reacts to settings and keyring changes, builds the state passed to the indicator | everything below |
| `prefs.js` | Settings window: token sign-in/out, repo filter, interval | `tokenStore`, `github` |
| `lib/indicator.js` | `PanelMenu.Button` subclass. Pure view: `render(state)` rebuilds the menu. No network or storage access. | `model` |
| `lib/github.js` | `GitHubClient`: authenticated REST calls with Soup 3, maps HTTP failures to typed errors | `model` |
| `lib/tokenStore.js` | Read/write/clear the token in the keyring via libsecret | — |
| `lib/model.js` | Pure functions: build search query, parse and group issues, classify errors, format times. **No `gi://` imports**, so it's unit-tested with Node. See [ADR 0004](adr/0004-pure-core-for-testing.md). | — |

## State

The extension keeps one state object and re-renders the indicator whenever it changes:

```js
{
    status: 'signed-out' | 'loading' | 'ready' | 'error',
    login: 'omer-gh' | null,
    groups: [{repo: 'owner/name', issues: [{number, title, url, updatedAt}]}],
    total: 31,             // total matches reported by GitHub
    updatedAt: Date|null,  // last successful refresh
    error: {kind: 'auth' | 'rate-limit' | 'network' | 'unknown', message, retryAt}|null,
}
```

## Refresh flow

1. On `enable()`, on each timer tick, on **Refresh**, and when settings change:
   `refresh()` runs. Concurrent calls are coalesced; a running request is cancelled with a
   `Gio.Cancellable` when a new one starts or on `disable()`.
2. Read the token from the keyring. None → `signed-out`.
3. `GET /user` (first time only, cached for the session) for the login.
4. `GET /search/issues?q=is:open is:issue assignee:@me archived:false [repo:…]&sort=updated&per_page=25`
   (see [ADR 0003](adr/0003-rest-search-api-for-issues.md)).
5. Group results by repository → `ready`. On failure, keep previous groups and set
   `error`. For rate limits, the next refresh is scheduled at the reset time.

The token is re-read from the keyring on every refresh, so signing in or out in Settings
takes effect at the next refresh; Settings also bumps a `token-changed` GSettings counter so
the extension refreshes immediately.

## Security

- The token is stored only in the keyring ([ADR 0002](adr/0002-token-in-gnome-keyring.md)),
  never in GSettings, files or logs. Error messages never include request headers.
- All requests go to `https://api.github.com` only; TLS is verified by Soup's defaults.
- Recommended token: fine-grained, read-only *Issues* and *Metadata*.

## Distribution

```
 src/ ──make pack──▶ extension zip ─┐
                                    ├─▶ tools/build-installer.sh ─▶ sourceglance-installer-X.Y.Z.sh
 tools/installer/installer.sh ──────┘        (wizard + base64 zip + its SHA-256)
                                                          │
           release.yml on tag vX.Y.Z ─▶ GitHub Release: installer, zip, SHA256SUMS,
                                         build provenance attestation
```

The installer runs as the user, never root. It verifies its payload, checks
compatibility, then calls `gnome-extensions install --force` and adds the UUID to
`enabled-extensions`. See [installer design](design/installer.md) and
[ADR 0005](adr/0005-self-contained-installer.md).

## Decisions

Architecture decisions are recorded in [`docs/adr/`](adr/). To propose a new one, copy
[the template](adr/template.md) in a PR.
