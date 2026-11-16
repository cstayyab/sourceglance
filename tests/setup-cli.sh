#!/usr/bin/env bash
# End-to-end test of the setup wizard's command-line mode in an isolated home (I12).
# Covers: bad usage, check, extract, damaged package, install, upgrade, repair, uninstall.
# Uses its own data/config/cache dirs and a keyfile settings backend; your desktop is untouched.
# Run via `make setup-test` (stages the payload first).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
UUID=sourceglance@omer-gh.github.io
WORK=$(mktemp -d "${TMPDIR:-/tmp}/sourceglance-setup-test.XXXXXX")
# SETUP_PAYLOAD: test a payload staged elsewhere (tools/build-setup.sh payload DIR).
PAYLOAD="${SETUP_PAYLOAD:-$ROOT/tools/installer/payload}"
EXT="$WORK/data/gnome-shell/extensions/$UUID"
BACKUPS="$WORK/cache/sourceglance-setup/backups"
VERSION=$(sed -n 's/.*"version-name": *"\([^"]*\)".*/\1/p' "$ROOT/src/metadata.json")
mkdir -p "$WORK"/{data,config,cache}

pass=0
fail() { echo "FAIL: $*" >&2; echo "Work dir kept: $WORK" >&2; exit 1; }
ok() { echo "ok - $*"; pass=$((pass + 1)); }

setup() {
    env -i HOME="$HOME" PATH="$PATH" USER="${USER:-}" \
        XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" XDG_CACHE_HOME="$WORK/cache" \
        GSETTINGS_BACKEND=keyfile SOURCEGLANCE_SETUP_PAYLOAD="${PAYLOAD_OVERRIDE:-$PAYLOAD}" \
        gjs -m "$ROOT/tools/installer/main.js" "$@"
}
enabled() {
    env -i HOME="$HOME" PATH="$PATH" XDG_CONFIG_HOME="$WORK/config" GSETTINGS_BACKEND=keyfile \
        gsettings get org.gnome.shell enabled-extensions
}
installed_version() { sed -n 's/.*"version-name": *"\([^"]*\)".*/\1/p' "$EXT/metadata.json"; }
backups() { find "$BACKUPS" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l; }

[[ -d $PAYLOAD ]] || fail "payload not staged; run 'make setup-payload'"

set +e
setup --bogus >/dev/null 2>&1; [[ $? -eq 2 ]] || fail "unknown option should exit 2"
setup --quiet >/dev/null 2>&1; [[ $? -eq 2 ]] || fail "--quiet without --accept-license should exit 2"
set -e
ok "bad usage exits 2"

[[ $(setup --version) == "$VERSION" ]] || fail "--version"
ok "--version prints $VERSION"

setup --check >/dev/null || fail "--check should pass on this system"
ok "--check passes"

setup --extract "$WORK/extracted" >/dev/null
[[ -f $WORK/extracted/metadata.json && -f $WORK/extracted/schemas/gschemas.compiled ]] || fail "--extract"
[[ ! -e $EXT ]] || fail "--extract must not install"
ok "--extract copies files and installs nothing"

DAMAGED="$WORK/damaged-payload"
cp -R "$PAYLOAD" "$DAMAGED"
echo "// tampered" >> "$DAMAGED/extension/extension.js"
set +e
PAYLOAD_OVERRIDE="$DAMAGED" setup --quiet --accept-license >/dev/null 2>&1; code=$?
set -e
[[ $code -eq 1 && ! -e $EXT ]] || fail "damaged package should exit 1 and change nothing (got $code)"
ok "damaged package is refused, nothing changed"

setup --quiet --accept-license > "$WORK/install.out"
grep -q "NO WARRANTY\|WITHOUT WARRANTY" "$WORK/install.out" || fail "license not printed"
[[ $(installed_version) == "$VERSION" ]] || fail "install: version"
enabled | grep -q "$UUID" || fail "install: not enabled"
[[ $(backups) -eq 0 ]] || fail "fresh install should not back up"
ok "install: files copied, enabled for next login"

# Installed layout: a loader at the top runs versions/<version>/ (tools/installer/loader).
[[ $(cat "$EXT/versions/current") == "$VERSION" ]] || fail "layout: versions/current"
[[ -f $EXT/versions/$VERSION/extension.js && -f $EXT/versions/$VERSION/schemas/gschemas.compiled ]] \
    || fail "layout: version folder"
grep -q SourceglanceLoader "$EXT/extension.js" && grep -q SourceglancePrefsLoader "$EXT/prefs.js" \
    || fail "layout: loaders"
[[ -f $EXT/stylesheet.css && -f $EXT/icons/sourceglance-symbolic.svg && -f $EXT/schemas/gschemas.compiled ]] \
    || fail "layout: top-level files GNOME Shell reads"
grep -q "Log out and back in" "$WORK/install.out" || fail "fresh install should ask to log out"
ok "layout: loader plus versions/$VERSION, log out to start the first time"

sed -i "s/\"version-name\": *\"$VERSION\"/\"version-name\": \"0.0.1\"/" "$EXT/metadata.json"
printf '0.0.1\n' > "$EXT/versions/current"
setup --quiet --accept-license > "$WORK/upgrade.out"
[[ $(installed_version) == "$VERSION" && $(backups) -eq 1 ]] || fail "upgrade"
[[ $(cat "$EXT/versions/current") == "$VERSION" ]] || fail "upgrade: versions/current"
# No GNOME Shell runs here, so nothing can be restarted: it asks for a log-out instead.
grep -q "Log out and back in" "$WORK/upgrade.out" || fail "upgrade without a Shell should ask to log out"
ok "upgrade from 0.0.1: replaced, previous version backed up"

setup --quiet --accept-license --repair >/dev/null
[[ $(installed_version) == "$VERSION" && $(backups) -eq 2 ]] || fail "repair"
ok "repair: reinstalled, backup kept"

# The extension writes an app grid icon when it runs; uninstall takes it away too.
LAUNCHER="$WORK/data/applications/io.github.omer_gh.sourceglance.desktop"
mkdir -p "$(dirname "$LAUNCHER")" && printf '[Desktop Entry]\n' > "$LAUNCHER"
setup --quiet --uninstall >/dev/null
[[ ! -e $EXT && $(backups) -eq 3 ]] || fail "uninstall: files"
enabled | grep -q "$UUID" && fail "uninstall: still enabled"
[[ ! -e $LAUNCHER ]] || fail "uninstall: app icon left behind"
ok "uninstall: removed (backup kept), turned off, app icon gone"

setup --quiet --uninstall | grep -q "not installed" || fail "second uninstall"
ok "uninstall when not installed is a no-op"

echo "All $pass setup CLI tests passed. Work dir: $WORK"
