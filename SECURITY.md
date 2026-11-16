# Security Policy

sourceglance handles GitHub access tokens, so we take security reports seriously.

## Supported versions

Only the latest release gets security fixes.

| Version | Supported |
|---------|-----------|
| latest  | ✅ |
| older   | ❌ |

## Reporting a vulnerability

**Do not open a public issue.** Instead, use GitHub's private reporting:

1. Go to the [Security tab](https://github.com/omer-gh/sourceglance/security/advisories/new).
2. Click **Report a vulnerability** and describe the problem, how to reproduce it, and its
   impact.

You can expect:

- An acknowledgement within **3 days**.
- An assessment and planned fix timeline within **10 days**.
- Credit in the release notes, if you'd like it.

## Handling tokens safely

- **Sign in with GitHub** grants the `repo` scope, which also allows writes; GitHub has
  no read-only scope for private issues. sourceglance only sends `GET` requests. You can
  revoke it any time under **Settings → Applications → Authorized OAuth Apps**.
- For the narrowest access, use a **fine-grained** personal access token with read-only
  access to issues and projects instead. It only sees the repositories you grant it.
- sourceglance stores the token in the GNOME keyring, never in GSettings or plain files.
- Never paste tokens into issues, logs or screenshots. If you leak one, revoke it right away
  in your GitHub settings.
