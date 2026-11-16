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

- **Sign in with GitHub** (the default) is limited to Issues, Pull requests and Projects
  (read and write) plus read-only Metadata, on the repositories you install it on. It has
  no access to code, settings or administration. Revoke it under
  **GitHub Settings → Applications → Authorized GitHub Apps**.
- **Sign in with full access** is opt-in. It grants the `repo` and `project` scopes, which
  allow writing to all your repositories and boards, because GitHub has no narrower scope
  for private issues. Revoke it under **Authorized OAuth Apps**.
- A **fine-grained** personal access token is also supported. It only sees the
  repositories you grant it; with read-only permissions, menu actions are refused.
- sourceglance only changes issues, pull requests (comments, state, assignees, labels) and
  project item status, and only when you pick an action in the menu. Closing asks for
  confirmation first. It never touches code, branches or repository settings.
- sourceglance stores the token in the GNOME keyring, never in GSettings or plain files.
- Never paste tokens into issues, logs or screenshots. If you leak one, revoke it right away
  in your GitHub settings.
