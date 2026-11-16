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

- Use a **fine-grained** personal access token with read-only access to issues and
  projects.
- sourceglance stores the token in the GNOME keyring, never in GSettings or plain files.
- Never paste tokens into issues, logs or screenshots. If you leak one, revoke it right away
  in your GitHub settings.

## How we keep sourceglance secure

- **Threat model:** [docs/security/threat-model.md](docs/security/threat-model.md) lists
  what we protect, the risks, and how each is handled.
- **Secure development:** [docs/security/secure-development.md](docs/security/secure-development.md)
  covers the automated checks (CodeQL, dependency review, Dependabot, secret scanning with
  push protection) and the review checklist every PR follows.
- **Release reviews:** each minor release gets a recorded security review before it ships.
