#!/usr/bin/env bash
# Reload sourceglance in your running session, without logging out (`make reload`).
#
# Copies src/ to a new folder inside the installed extension and switches the extension off
# and on. A small loader (tools/dev-loader/) imports the build from that new folder, which
# sidesteps GNOME Shell's module cache. Changes to metadata.json still need a new login.
# `make install` puts the normal extension back.
#
# When Setup installed Source Glance, the session may still be running Setup's loader
# (tools/installer/loader/), cached at login: it imports versions/<versions/current>/. So each
# build also goes into a new versions/ folder, and whichever loader the Shell has runs it.
set -euo pipefail

UUID=sourceglance@omer-gh.github.io
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

if ! gnome-extensions info "$UUID" >/dev/null 2>&1; then
    echo "This session doesn't know Source Glance yet. Run 'make install', log out and back in" >&2
    echo "once, then use 'make reload' from then on." >&2
    exit 1
fi

stamp=$(date +%Y%m%d-%H%M%S-%N)
build="$DIR/dev/$stamp"
mkdir -p "$build"
cp -r "$ROOT/src/." "$build/"
glib-compile-schemas "$build/schemas"

# The loader, plus what the Shell reads from the extension folder itself on enable.
cp "$ROOT/tools/dev-loader/extension.js" "$ROOT/tools/dev-loader/prefs.js" "$ROOT/tools/dev-loader/devBuild.js" "$DIR/"
cp "$ROOT/src/stylesheet.css" "$DIR/"
mkdir -p "$DIR/schemas"
cp "$ROOT"/src/schemas/*.gschema.xml "$DIR/schemas/"
glib-compile-schemas "$DIR/schemas"
printf '%s\n' "$stamp" > "$DIR/dev/current"

# Setup's loader takes only an X.Y.Z folder name: the source's X.Y with a patch number from
# 900001 up, new for every build. Its metadata.json still says the source's version.
if [[ -d $DIR/versions ]]; then
    minor=$(sed -n 's/.*"version-name": *"\([0-9]*\.[0-9]*\)\..*/\1/p' "$ROOT/src/metadata.json")
    count=$(cat "$DIR/versions/dev-build" 2>/dev/null || echo 900000)
    while [[ -e $DIR/versions/$minor.$((count + 1)) ]]; do count=$((count + 1)); done
    version="$minor.$((count + 1))"
    printf '%s\n' "$((count + 1))" > "$DIR/versions/dev-build"
    cp -r "$build" "$DIR/versions/$version"
    printf '%s\n' "$version" > "$DIR/versions/current"
    stamp="$stamp, versions/$version"
fi

state_of() { gnome-extensions info "$UUID" | sed -n 's/^ *State: //p'; }

gnome-extensions disable "$UUID"
# Enabling again before the Shell has finished disabling is ignored, so wait for it.
for _ in $(seq 1 20); do
    [[ $(state_of) != ACTIVE ]] && break
    sleep 0.25
done
gnome-extensions enable "$UUID"
# The loader imports the build asynchronously; wait for it to settle.
for _ in $(seq 1 20); do
    state=$(state_of)
    [[ $state == ACTIVE || $state == ERROR ]] && break
    sleep 0.25
done
echo "Reloaded Source Glance (build $stamp): $state"
if [[ $state != ACTIVE ]]; then
    echo "Errors: journalctl --user -b -o cat | grep -i -A8 sourceglance" >&2
    exit 1
fi
