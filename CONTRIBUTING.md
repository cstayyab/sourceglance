# Contributing to sourceglance

Thanks for helping out! This page covers the rules for issues, pull requests, commits and
docs. If something here is unclear, open an issue and say so — that counts as a
contribution too.

## Ground rules

- Be kind. Everyone follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Search existing issues and pull requests before opening a new one.
- Security problems go through [SECURITY.md](SECURITY.md), **never** a public issue.
- One topic per issue, one change per pull request.

## Issues

### Opening an issue

Use one of the templates — blank issues are turned off:

| Template | Use it for |
|----------|------------|
| **Bug report** | Something is broken or behaves differently than documented |
| **Feature request** | A new capability or a change to existing behaviour |
| **Questions** | Use [Discussions](https://github.com/omer-gh/sourceglance/discussions), not issues |

A good bug report includes your Ubuntu version, GNOME Shell version
(`gnome-shell --version`), sourceglance version, steps to reproduce, and logs from
`journalctl -f -o cat /usr/bin/gnome-shell`. **Remove any tokens from logs before pasting.**

### Labels

Maintainers apply labels during triage:

| Label | Meaning |
|-------|---------|
| `bug` | Confirmed defect |
| `enhancement` | New feature or improvement |
| `documentation` | Docs only |
| `needs-triage` | New, not yet reviewed (added automatically by templates) |
| `needs-info` | Waiting on the reporter; closed after 14 days without reply |
| `good first issue` | Small, well-scoped, good for newcomers |
| `help wanted` | Maintainers would welcome a PR |
| `wontfix` / `duplicate` | Closed with an explanation or a link |

### Triage expectations

- Maintainers aim to respond to new issues within **7 days**.
- Want to work on an issue? Comment first so it can be assigned to you. If an assigned issue
  has no activity for 30 days, it may be reassigned.

## Pull requests

1. Fork the repo and create a branch from `main`: `feat/short-name`, `fix/short-name`,
   or `docs/short-name`.
2. Follow [docs/development.md](docs/development.md) to run the extension locally.
3. Keep the change focused. Large features should start as an issue so the design can be
   agreed first.
4. Run `make lint` and test in a nested GNOME Shell session.
5. Update docs and add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for
   any user-visible change.
6. Open the PR, fill in the template, and link the issue (`Closes #123`).

PRs need one maintainer approval and passing CI to merge. Maintainers squash-merge, so the
PR title becomes the commit message — write it in Conventional Commit form (below).

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short summary in present tense>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
Add `!` after the type (e.g. `feat!:`) for breaking changes.

Examples:

```
feat(panel): show unread count on the indicator
fix(api): retry when GitHub returns 502
docs: explain how to create a fine-grained token
```

## Code style

- Modern GJS with ES modules (`import`/`export`), following the
  [GNOME Shell extension guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).
- Create objects, connect signals and start timers in `enable()`; destroy and disconnect
  **all** of them in `disable()`. Reviewers check this on every PR.
- Never log or store tokens in plain text. Secrets go in the GNOME keyring (libsecret).
- Formatting and lint rules are enforced by ESLint (`make lint`). Settings are in
  `.editorconfig`: 4-space indent, LF line endings, single quotes.

## Documentation

See [docs/writing-docs.md](docs/writing-docs.md). In short: if your change alters what users
see or how contributors work, update the docs in the same PR.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
