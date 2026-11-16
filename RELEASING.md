# Releasing sourceglance

## Versioning

sourceglance follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

| Bump | When | Example |
|------|------|---------|
| `PATCH` | Bug fixes only, no new behaviour | `0.1.0` → `0.1.1` |
| `MINOR` | New features, backwards compatible | `0.1.1` → `0.2.0` |
| `MAJOR` | Breaking changes (removed settings, dropped GNOME versions) | `0.9.0` → `1.0.0` |

Before `1.0.0`, minor releases may include breaking changes; call them out clearly in the
changelog.

`src/metadata.json` holds two version fields:

- `version-name` — the SemVer string shown to users (`"0.2.0"`).
- `version` — an integer that goes up by 1 on every release. extensions.gnome.org requires
  it.

## Release cadence

- Releases happen when there's something worth shipping — no fixed schedule.
- Security fixes are released as a `PATCH` as soon as they're ready.
- Each new GNOME Shell version should get a compatibility release within about a month of
  its launch.

## Who can release

Only maintainers with write access. Every release is cut from `main` with CI passing.

## Checklist

1. **Make sure `main` is green** and all PRs for the milestone are merged. No open CodeQL
   or Dependabot alerts of moderate severity or higher.
2. **Security review**: close the milestone's `security` issue (review of the diff since the
   last release, see [secure development](docs/security/secure-development.md#security-reviews))
   and update "Last reviewed" in the [threat model](docs/security/threat-model.md).
3. **Docs check**: README, `docs/` and screenshots match the release; the Docs workflow is
   green.
4. **Update `CHANGELOG.md`**: rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, add a
   fresh empty `## [Unreleased]` above it, and update the compare links at the bottom.
5. **Bump versions** in `src/metadata.json`: set `version-name` to `X.Y.Z` and increase
   `version` by 1. Update `shell-version` if support changed. Also set `version` in
   `package.json`.
6. **Commit and open a PR** titled `chore(release): vX.Y.Z`. Merge it after review.
7. **Tag the merge commit** on `main`:

   ```bash
   git tag -a vX.Y.Z -m "sourceglance vX.Y.Z"
   ```

   ```bash
   git push origin vX.Y.Z
   ```

8. **CI publishes the release.** The `release` workflow builds the extension zip and creates
   a GitHub Release from the tag, using the matching changelog section as the notes. Check
   the release page once it finishes.
9. **Upload to extensions.gnome.org** (from `v1.0.0` on): upload the zip from the GitHub
   Release at <https://extensions.gnome.org/upload/>.
10. **Announce** in Discussions and close the milestone.

## Release notes

Release notes come from `CHANGELOG.md`, which follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Group entries under **Added**,
**Changed**, **Deprecated**, **Removed**, **Fixed** and **Security**. Write each entry for
users, not developers ("The menu now shows issues from private repos", not "refactor
fetchIssues()"), and link the PR.

## If a release goes wrong

Don't delete or move a published tag. Fix the problem on `main` and release a new `PATCH`.
