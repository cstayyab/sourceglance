#!/usr/bin/env bash
# Reload sourceglance in your running session, without logging out (`make reload`).
#
# Copies src/ to a new folder inside the installed extension and switches the extension off
# and on. A small loader (tools/dev-loader/) imports the build from that new folder, which
# sidesteps GNOME Shell's module cache. Changes to metadata.json still need a new login.
# `make install` puts the normal extension back.
set -euo pipefail

UUID=sourceglance@omer-gh.github.io
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

if ! gnome-extensions info "$UUID" >/dev/null 2>&1; then
    echo "This session doesn't know sourceglance yet. Run 'make install', log out and back in" >&2
    echo "once, then use 'make reload' from then on." >&2
    exit 1
fi

stamp=$(date +%Y%m%d-%H%M%S-%N)
build="$DIR/dev/$stamp"
mkdir -p "$build"
cp -r "$ROOT/src/." "$build/"
glib-compile-schemas "$build/schemas"

# The loader, plus what the Shell reads from the extension folder itself on enable.
cp "$ROOT/tools/dev-loader/extension.js" "$ROOT/tools/dev-loader/prefs.js" "$DIR/"
cp "$ROOT/src/stylesheet.css" "$DIR/"
mkdir -p "$DIR/schemas"
cp "$ROOT"/src/schemas/*.gschema.xml "$DIR/schemas/"
glib-compile-schemas "$DIR/schemas"
printf '%s\n' "$stamp" > "$DIR/dev/current"

gnome-extensions disable "$UUID"
gnome-extensions enable "$UUID"
# The loader imports the build asynchronously; wait for it to settle.
for _ in $(seq 1 20); do
    state=$(gnome-extensions info "$UUID" | sed -n 's/^ *State: //p')
    [[ $state == ACTIVE || $state == ERROR ]] && break
    sleep 0.25
done
echo "Reloaded sourceglance (build $stamp): $state"
if [[ $state != ACTIVE ]]; then
    echo "Errors: journalctl --user -b -o cat | grep -i -A8 sourceglance" >&2
    exit 1
fi
