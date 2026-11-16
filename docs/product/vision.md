# Product vision

## Problem

Developers on Ubuntu keep a browser tab open on GitHub just to see what's assigned to them
and where cards sit on their project boards. Checking means switching context, and missing
a new assignment means slower responses for teammates.

## Vision

**See your GitHub work at a glance, without leaving what you're doing.** sourceglance lives in
the GNOME top bar and answers two questions in one click: *What's assigned to me?* and
*Where does my project stand?*

## Who it's for

| Persona | Needs | What success looks like |
| --------- | ------- | ------------------------- |
| **Solo maintainer** (primary) | Track issues across a handful of personal and open source repos | Never opens a browser tab just to check assignments |
| **Team developer** | Keep up with issues assigned across the team's org repos | Notices new assignments within one refresh cycle |
| **Tech lead / PM** (v0.2+) | Watch a GitHub Projects board's columns | Knows board status without opening GitHub |

## Principles

1. **Glanceable first.** The top-bar icon alone should tell you whether there's something
   to look at. The menu is for detail, GitHub is for action.
2. **Calm by default.** No noisy notifications unless the user turns them on. Sensible
   refresh intervals that respect GitHub's rate limits.
3. **Secure by default.** Tokens live in the GNOME keyring. We ask for read-only access and
   tell users exactly which permissions to grant.
4. **Feels native.** Follows GNOME HIG and Shell styling; uses libadwaita for settings.
5. **Small and reviewable.** Minimal dependencies (none beyond what GNOME ships), so the
   extension passes extensions.gnome.org review.

## Goals for v1.0

- Show assigned issues and GitHub Projects (v2) boards in the top bar.
- Optional notifications for new assignments.
- Published on extensions.gnome.org, supporting the current Ubuntu LTS and newer.

## Non-goals

- Editing issues, commenting, or moving cards. sourceglance links to GitHub for actions.
- Pull request review queues (may be revisited after v1.0).
- GitLab, Gitea or other forges.
- Desktop environments other than GNOME Shell.

## Success metrics

| Metric | Target by v1.0 |
| -------- | ---------------- |
| Installs on extensions.gnome.org | 1,000 |
| Rating on extensions.gnome.org | ≥ 4.5 |
| Crash or "extension error" reports per release | 0 open for more than 14 days |
| Time from GNOME release to compatible sourceglance release | ≤ 30 days |
