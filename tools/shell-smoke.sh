#!/usr/bin/env bash
# Smoke-test the extension in an isolated headless GNOME Shell (R9).
# Uses its own D-Bus session, in-memory GSettings and a throwaway data dir, so your
# desktop session and settings are not touched. Requires GNOME Shell 46+.
set -euo pipefail

UUID=sourceglance@omer-gh.github.io
CYCLES=${CYCLES:-10}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/sourceglance-smoke.XXXXXX")
EXT="$WORK/data/gnome-shell/extensions/$UUID"

mkdir -p "$EXT" "$WORK"/{config,cache,state}
cp -r "$ROOT/src/." "$EXT/"
glib-compile-schemas "$EXT/schemas"

cat > "$WORK/run.sh" <<'EOF'
set -u
gnome-shell --headless --virtual-monitor 1280x800 --wayland --no-x11 \
    --wayland-display "$WAYLAND_DISPLAY" > "$WORK/shell.log" 2>&1 &
PID=$!
for _ in $(seq 1 30); do gnome-extensions info "$UUID" >/dev/null 2>&1 && break; sleep 1; done
gnome-extensions enable "$UUID"; sleep 3
echo "after enable:   $(gnome-extensions info "$UUID" | grep -i state)"
for _ in $(seq 1 "$CYCLES"); do
    gnome-extensions disable "$UUID"; sleep 0.3
    gnome-extensions enable "$UUID"; sleep 0.5
done
sleep 2
echo "after $CYCLES cycles: $(gnome-extensions info "$UUID" | grep -i state)"
gnome-extensions disable "$UUID"; sleep 1
echo "after disable:  $(gnome-extensions info "$UUID" | grep -i state)"
kill "$PID"; wait "$PID" 2>/dev/null || true
EOF

# The test Shell gets its own display name, and so does everything it starts (Settings,
# portals): left unset, apps fall back to your desktop's display and open there.
env -i HOME="$HOME" PATH="$PATH" USER="$USER" WORK="$WORK" UUID="$UUID" CYCLES="$CYCLES" \
    XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" \
    XDG_CACHE_HOME="$WORK/cache" XDG_STATE_HOME="$WORK/state" \
    XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" GSETTINGS_BACKEND=memory \
    WAYLAND_DISPLAY="sourceglance-smoke-$$" \
    timeout 120 dbus-run-session -- bash "$WORK/run.sh" 2>"$WORK/dbus.log"

echo
if grep -q -E "JS ERROR|$UUID.*[Ee]rror" "$WORK/shell.log"; then
    echo "FAIL: errors in the Shell log:"
    grep -E "JS ERROR|$UUID.*[Ee]rror" "$WORK/shell.log"
    status=1
else
    echo "PASS: no extension errors in the Shell log."
    status=0
fi
echo "Logs kept in $WORK"
exit $status
