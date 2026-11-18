# Architecture

sourceglance is a GNOME Shell extension (see [ADR 0001](adr/0001-gnome-shell-extension.md)).
It runs in two processes that share code under `src/lib/`:

- **Shell process** — `extension.js` runs inside `gnome-shell`. It owns the panel
  indicator and the refresh loop. A crash or blocking call here freezes the desktop, so
  everything is async and every resource is released in `disable()`.
- **Window process** — the window (`window/app.js`) runs in a separate `gjs` process. The app
  icon and the top bar open it in Source Glance's own app (`launcher.js`, app ID
  `io.github.omer_gh.sourceglance`, matching the app icon's `.desktop` file), so the dock shows
  it as Source Glance. GNOME's Extensions app can still open the same window through `prefs.js`.
  Settings → Accounts adds and removes accounts, checking each sign-in before storing it.

```
 ┌──────────────────────── gnome-shell process ────────────────────────┐
 │                                                                     │
 │  extension.js  ──owns──▶  Indicator (lib/indicator.js)              │
 │       │                       ▲  render(state)                      │
 │       │ timer / settings      │                                     │
 │       ▼                       │                                     │
 │  refresh() ──▶ accountStore ──▶ GitHubClient / GitLabClient ──▶     │
 │   per account  (lib/accountStore,   (one per account,   model.js,   │
 │                 lib/tokenStore)      lib/transport)     accounts.js │
 │                    │                      │              (pure)     │
 └────────────────────┼──────────────────────┼─────────────────────────┘
                      ▼                      ▼
              GNOME keyring          api.github.com, gitlab.com,
              (one entry per         self-hosted instances you added
               account)              (HTTPS; http:// only on the LAN)
                      ▲                      ▲
 ┌────────────────────┼──────────────────────┼─── gjs window process ──┐
 │  window/app.js ──▶ accountStore      the same clients (lists,       │
 │  (Settings → Accounts, add-account dialog)  actions, sign-in)       │
 └─────────────────────────────────────────────────────────────────────┘
          both read/write non-secret settings (incl. the account list) via GSettings
```

## Modules

| Module | Responsibility | Depends on |
| -------- | ---------------- | ------------ |
| `extension.js` | Lifecycle (`enable`/`disable`), refresh timer, reacts to settings and keyring changes, builds the state passed to the indicator | everything below |
| `launcher.js` | Source Glance's own app: splash, then the window (`window/app.js`); `--open` skips the splash | `window/app.js` |
| `prefs.js` | The same window when GNOME's Extensions app opens it | `window/app.js` |
| `lib/indicator.js` | `PanelMenu.Button` subclass. Pure view: `render(state)` rebuilds the menu. No network or storage access. | `model` |
| `lib/github.js` | `GitHubClient`: authenticated REST calls to github.com or a GitHub Enterprise Server instance, maps HTTP failures to typed errors | `model`, `accounts`, `transport` |
| `lib/gitlab.js` | `GitLabClient`: the same for gitlab.com or a self-managed instance, with token renewal | `gitlabModel`, `accounts`, `transport` |
| `lib/transport.js` | Sends requests for one instance; plain http:// only to checked LAN addresses, pinned per connection; no redirects for self-hosted instances ([ADR 0007](adr/0007-multiple-accounts-and-self-hosted-instances.md)) | `accounts` |
| `lib/updateNotice.js` | Once per login, a notification when a newer release is out, with short release notes; Install opens the window and starts its update | `updates`, `github` |
| `lib/wallpaper.js` | The recommended wallpaper (Settings → Desktop Widgets): Apply keeps yours in `saved-wallpaper`, Reset puts it back; the extension forgets the copy when the wallpaper changes any other way | `model` |
| `lib/accountStore.js` | The account list (GSettings `accounts`) and each account's keyring entry, migration of the first sign-ins, a client per account, loading one account's lists | clients, `tokenStore` |
| `lib/accounts.js` | Pure: instance URLs, LAN addresses, account records and ids, section titles, one account's part of the state (`sourceFrom`) | `model` |
| `lib/tokenStore.js` | Read/write/clear an account's sign-in in the keyring via libsecret | — |
| `lib/model.js` | Pure functions: build search query, parse and group issues, classify errors, format times. **No `gi://` imports**, so it's unit-tested with Node. See [ADR 0004](adr/0004-pure-core-for-testing.md). | — |

## State

The extension keeps one state object and re-renders the indicator whenever it changes:

```js
{
    status: 'signed-out' | 'loading' | 'ready' | 'error',   // all accounts together
    sources: [{                       // one per account, in Settings → Accounts order
        account: {id, platform, base, login, method, clientId},
        key: 'github' | 'gitlab' | '<account id>',   // section id in collapsed-* settings
        title: 'GitHub · @alice',
        status, updatedAt, error,     // this account's own
        groups: [{repo: 'owner/name', issues: [{number, title, url, accountId, …}]}],
        prGroups, issueTotal, issueShown, prTotal, prShown, closedCounts,
        boards, boardsError,          // GitHub accounts' project boards
    }],
    updatedAt: Date|null,  // most recent refresh of any account
    error: {kind: 'auth' | 'rate-limit' | 'network' | 'insecure' | 'unknown', retryAt}|null,
    recentlyClosed, busy, refreshing, intervalMinutes,
}
```

With one account the lists look as they always did; with several, each account gets a
collapsible section ([ADR 0007](adr/0007-multiple-accounts-and-self-hosted-instances.md)).

## Refresh flow

1. On `enable()`, on each timer tick, on **Refresh**, and when settings change:
   `refresh()` runs. Concurrent calls are coalesced; a running request is cancelled with a
   `Gio.Cancellable` when a new one starts or on `disable()`.
2. Read the account list (adding the first github.com and gitlab.com sign-ins if they're in
   the keyring but not listed). No accounts → `signed-out`.
3. For every account at once, read its token from the keyring and load its lists:
   - GitHub: `GET /user` for the login, then
     `GET /search/issues?q=is:open is:issue assignee:@me archived:false [repo:…]&sort=updated&per_page=25`
     and the PR searches ([ADR 0003](adr/0003-rest-search-api-for-issues.md)), then the project
     boards.
   - GitLab: the assigned issues and merge requests, and those awaiting your review.
4. Group each account's results by repository into its source. If one account fails, its
   previous groups stay and only its section shows the error. For rate limits, the next
   refresh is scheduled at the reset time.

Tokens are re-read from the keyring on every refresh. Settings → Accounts bumps a
`token-changed` GSettings counter so the extension refreshes immediately, and writing the
`accounts` key has the same effect.

## Security

- Tokens are stored only in the keyring, one entry per account ([ADR 0002](adr/0002-token-in-gnome-keyring.md),
  [ADR 0007](adr/0007-multiple-accounts-and-self-hosted-instances.md)), never in GSettings, files or
  logs. Error messages never include request headers.
- Requests go to `api.github.com`, `gitlab.com` and the self-hosted instances you added, each
  account's only to its own instance. TLS is verified by Soup's defaults; plain http:// is only
  used for local-network instances, checked on every connection.
- Each sign-in method in the add-account dialog says which repositories it reaches.

## Distribution

```
 src/ ──make pack──▶ extension zip ─┐
 tools/installer/ (GJS wizard) ─────┼─▶ appimagetool (pinned) ─▶ sourceglance-Setup-X.Y.Z-<arch>.AppImage
 LICENSE ───────────────────────────┘    AppRun: exec gjs -m installer/main.js
                                                          │
           release.yml on tag vX.Y.Z ─▶ GitHub Release: AppImages, zip, SHA256SUMS,
                                         build provenance attestation
```

The setup wizard runs as the user, never root, using the system's GJS, GTK 4 and
libadwaita. Its decision logic (install vs. upgrade vs. repair, version comparison, checks)
lives in a pure module tested with Node; file operations go through `gnome-extensions` and
`Gio`, with the previous version backed up for rollback. See
[installer design](design/installer.md) and [ADR 0005](adr/0005-self-contained-installer.md).

## Decisions

Architecture decisions are recorded in [`docs/adr/`](adr/). To propose a new one, copy
[the template](adr/template.md) in a PR.
