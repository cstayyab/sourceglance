# Threat model

Reviewed for every minor release and whenever a PR touches authentication, networking,
storage, or anything rendered from GitHub data. Last reviewed: **2026-11-16 (v0.1.0)**.

## What we protect

| Asset | Why it matters |
|-------|----------------|
| **GitHub token** | Grants access to the user's repositories; leaking it is the worst outcome. |
| **The user's desktop session** | The extension runs inside GNOME Shell with the user's full privileges. A crash freezes the desktop; malicious code could do anything the user can. |
| **Private repository data** | Issue titles and repo names from private repos must not leave the machine except to GitHub. |

## Trust boundaries

```
 user ──▶ Settings (gjs process) ──▶ GNOME keyring (libsecret)
                     │                       ▲
                     ▼                       │
 GNOME Shell process (extension) ────────────┘
          │  HTTPS (Soup 3, system CA store)
          ▼
   api.github.com  ──▶  issue data rendered in the panel menu
```

GitHub API responses are **untrusted input**: issue titles and URLs are written by other
people.

## Threats and mitigations

| # | Threat | Mitigation | Status |
|---|--------|------------|--------|
| T1 | Token read from disk or backups | Stored only in the GNOME keyring ([ADR 0002](../adr/0002-token-in-gnome-keyring.md)); never in GSettings/dconf or files | ✅ v0.1 |
| T2 | Token leaked in logs, errors, issues or screenshots | Errors carry only kind + HTTP status; token never logged; Settings clears the field after saving; issue templates remind users to scrub logs | ✅ v0.1 |
| T3 | Token sent to the wrong host / intercepted | Requests go only to the hard-coded `https://api.github.com`; Soup verifies TLS with the system CA store | ✅ v0.1 |
| T4 | Over-privileged token | Docs and Settings recommend a fine-grained, read-only token (Issues + Metadata) | ✅ v0.1 |
| T5 | Search-query injection via the repository filter | Repo names validated against `owner/name` before building `repo:` qualifiers | ✅ v0.1 |
| T6 | Markup injection from issue titles | Titles rendered as plain text (`St.Label` without markup) | ✅ v0.1 |
| T7 | Malicious link opened from an issue | Only `https://github.com/` URLs are opened | ✅ v0.1 |
| T8 | Desktop freeze from blocking I/O or leaks | All I/O async and cancellable; everything released in `disable()`; smoke test enables/disables 10× | ✅ v0.1 |
| T9 | Rate-limit abuse / hammering GitHub | Minimum 1-minute interval, debounced settings changes, honours rate-limit reset | ✅ v0.1 |
| T10 | Supply-chain compromise | No runtime dependencies beyond GNOME libraries; dev-only npm deps; Dependabot, dependency review and CodeQL in CI; GitHub Actions pinned to commit SHAs | ✅ v0.1 |
| T11 | Compromised release artifact | Releases built by CI from a tag on `main`; only maintainers can tag | ✅ v0.1 |
| T12 | Secrets committed to the repo | GitHub secret scanning with push protection | ✅ v0.1 |
| T13 | Locked or unavailable keyring | Treated as signed out; no fallback to insecure storage | ✅ v0.1 |

## Out of scope

- A compromised user account or desktop session (an attacker with the user's privileges can
  already read the keyring).
- Compromise of GitHub itself.

## When to update this document

Update the table in the same PR when you add a network call, a new place data is stored, a
new kind of GitHub data shown to the user, or a new dependency.
