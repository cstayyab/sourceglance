# Writing documentation

## Where docs live

| What | Where |
|------|-------|
| What sourceglance is, installing it, basic usage | `README.md` |
| Contributor guides and deeper topics | `docs/` (one topic per file, linked from `docs/README.md`) |
| Contribution rules | `CONTRIBUTING.md` |
| Release process | `RELEASING.md` |
| What changed in each version | `CHANGELOG.md` |
| Security policy | `SECURITY.md` |

## Rules

1. **Docs ship with code.** A PR that changes behaviour, settings or setup steps updates
   the docs in the same PR. Reviewers will ask for it.
2. **Write for a newcomer.** Assume the reader knows Ubuntu but not GNOME Shell internals.
3. **Be short and concrete.** Lead with the task ("To change the refresh interval…"), use
   numbered steps for procedures, and put commands in fenced code blocks with a language
   tag (`bash`, `js`).
4. **One command per code block** so readers can copy it safely.
5. **Use relative links** between docs (`[Releasing](../RELEASING.md)`), so they work on
   GitHub and in forks.
6. **Screenshots** go in `docs/images/` as PNG, under 300 KB, with alt text. Blur or crop
   anything personal, and never show a token.
7. **No secrets, ever** — not even fake-looking ones. Write `<YOUR_TOKEN>` instead.

## Style

- Plain English, present tense, second person ("you").
- Sentence-case headings ("Run it locally", not "Run It Locally").
- Name UI elements in **bold** exactly as they appear on screen.
- Write "GNOME Shell", "GitHub", "Ubuntu" with that capitalization.
