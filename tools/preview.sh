#!/usr/bin/env bash
# Preview sourceglance locally.
#
#   ./tools/preview.sh            # nested GNOME Shell in a window (default, safest)
#   ./tools/preview.sh --session  # load into your real desktop session
#
# Run with --help for details. You must accept the MIT License before it does anything.
set -euo pipefail

UUID=sourceglance@omer-gh.github.io
ROOT=$(cd "$(dirname "$0")/.." && pwd)
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
PREVIEW_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/sourceglance-preview"
LICENSE_URL="https://github.com/omer-gh/sourceglance/blob/main/LICENSE"
MIT_URL="https://opensource.org/license/mit"

MODE=nested
ACCEPTED=0

bold=$'\e[1m'; red=$'\e[31m'; yellow=$'\e[33m'; reset=$'\e[0m'
[[ -t 1 ]] || { bold=''; red=''; yellow=''; reset=''; }

usage() {
    cat <<EOF
Usage: $(basename "$0") [--nested | --session] [--accept-license] [--help]

  --nested          Run a second GNOME Shell in a window and load Source Glance there
                    (default). Safe for your desktop. Good for checking the UI;
                    signing in may not work because the nested session can't reach
                    your keyring.
  --session         Install and enable Source Glance in your real desktop session. Use
                    this to test signing in. A bug here can affect your desktop.
  --accept-license  Accept the MIT License non-interactively (for scripts). Only use
                    this if you have read the license at $LICENSE_URL
  --help            Show this help.
EOF
}

die() { echo "${red}Error:${reset} $*" >&2; exit 1; }

has_devkit() {
    if command -v dpkg-query >/dev/null; then
        dpkg-query -W -f='${Status}' mutter-dev-bin 2>/dev/null | grep -q 'install ok installed'
    else
        command -v mutter-devkit >/dev/null || compgen -G '/usr/lib*/mutter-devkit' >/dev/null \
            || compgen -G '/usr/libexec/mutter-devkit' >/dev/null
    fi
}

confirm() {
    local reply
    read -r -p "$1 [y/N] " reply
    [[ $reply =~ ^[Yy]([Ee][Ss])?$ ]]
}

while [[ $# -gt 0 ]]; do
    case $1 in
    --nested) MODE=nested ;;
    --session) MODE=session ;;
    --accept-license) ACCEPTED=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
    esac
    shift
done

# ---------------------------------------------------------------------------
# 1. Risks, license and agreement
# ---------------------------------------------------------------------------
cat <<EOF

${bold}Source Glance local preview${reset}

${yellow}${bold}WARNING — read before continuing${reset}
Source Glance is ${bold}pre-release software${reset}. This script will:
  • check for required tools and, ${bold}only if you confirm${reset}, install missing ones
    with ${bold}sudo apt install${reset} (system-wide changes, needs your password);
  • copy the extension into ${INSTALL_DIR}
    (replacing any Source Glance already there);
EOF
if [[ $MODE == nested ]]; then
    cat <<EOF
  • start a second GNOME Shell in a window. It can use a lot of CPU and memory.
    Its settings are kept separately in ${PREVIEW_DIR}.
EOF
else
    cat <<EOF
  • ${red}${bold}enable Source Glance in your real desktop session.${reset} GNOME Shell extensions run
    inside the desktop itself: a bug can freeze or crash your session and you
    could lose unsaved work. Save your work first.
EOF
fi
cat <<EOF
  • If you sign in, your GitHub token is stored in your GNOME keyring and sent
    only to api.github.com. Use a fine-grained, read-only token.

${bold}License and warranty${reset}
Source Glance is licensed under the MIT License:
  ${LICENSE_URL}
  (also in ${ROOT}/LICENSE; about the MIT License: ${MIT_URL})

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY arising from the software or its use.

${bold}You run this script and the software entirely at your own risk.${reset} There is
no warranty and no obligation to provide support.

EOF

if [[ $ACCEPTED -eq 1 ]]; then
    echo "License accepted with --accept-license."
elif [[ -t 0 ]]; then
    read -r -p "Type ${bold}I agree${reset} to accept the license and these risks, or anything else to quit: " answer
    [[ ${answer,,} == "i agree" ]] || { echo "Not accepted. Nothing was changed."; exit 1; }
else
    die "No terminal to ask for license agreement. Re-run interactively, or pass --accept-license after reading $LICENSE_URL"
fi
echo

# ---------------------------------------------------------------------------
# 2. One-time setup: check and install requirements
# ---------------------------------------------------------------------------
command -v gnome-shell >/dev/null || die "GNOME Shell is not installed. Source Glance only runs on GNOME."
SHELL_MAJOR=$(gnome-shell --version | grep -oE '[0-9]+' | head -1)
(( SHELL_MAJOR >= 46 )) || die "GNOME Shell $SHELL_MAJOR found; Source Glance needs 46 or newer (Ubuntu 24.04+)."
echo "Found GNOME Shell $SHELL_MAJOR."

missing_pkgs=()
command -v gnome-extensions >/dev/null || missing_pkgs+=(gnome-shell)
command -v glib-compile-schemas >/dev/null || missing_pkgs+=(libglib2.0-bin)
if [[ $MODE == nested ]]; then
    command -v dbus-run-session >/dev/null || missing_pkgs+=(dbus-bin)
    # GNOME 49+ draws nested sessions with the mutter devkit viewer.
    if (( SHELL_MAJOR >= 49 )) && ! has_devkit; then
        missing_pkgs+=(mutter-dev-bin)
    fi
fi

if (( ${#missing_pkgs[@]} > 0 )); then
    echo "${bold}One-time setup:${reset} these packages are needed: ${missing_pkgs[*]}"
    command -v apt-get >/dev/null || die "Install them with your package manager, then re-run."
    confirm "Run 'sudo apt install ${missing_pkgs[*]}' now?" || die "Cancelled. Nothing was installed."
    sudo apt-get install -y "${missing_pkgs[@]}"
else
    echo "All requirements are installed."
fi

# ---------------------------------------------------------------------------
# 3. Install the extension files
# ---------------------------------------------------------------------------
if [[ -d $INSTALL_DIR ]]; then
    confirm "Replace the existing Source Glance in $INSTALL_DIR with this checkout?" \
        || die "Cancelled. Nothing was changed."
fi
mkdir -p "$INSTALL_DIR"
cp -r "$ROOT/src/." "$INSTALL_DIR/"
glib-compile-schemas "$INSTALL_DIR/schemas"
echo "Installed extension files to $INSTALL_DIR"

# ---------------------------------------------------------------------------
# 4a. Session mode: enable in the real desktop
# ---------------------------------------------------------------------------
if [[ $MODE == session ]]; then
    if gnome-extensions info "$UUID" >/dev/null 2>&1; then
        gnome-extensions enable "$UUID"
        echo
        echo "${bold}Source Glance is enabled in your session.${reset} Click its icon in the top bar."
        echo "Code changes only take effect after you log out and back in."
    else
        echo
        echo "GNOME Shell only discovers new extensions at login. ${bold}Log out and back in${reset}, then run:"
        echo "  gnome-extensions enable $UUID"
    fi
    echo "To turn it off:  gnome-extensions disable $UUID"
    echo "Logs:            journalctl -f -o cat /usr/bin/gnome-shell | grep -i sourceglance"
    exit 0
fi

# ---------------------------------------------------------------------------
# 4b. Nested mode: second GNOME Shell in a window
# ---------------------------------------------------------------------------
if (( SHELL_MAJOR >= 49 )); then
    NESTED_ARGS=(--devkit)
else
    NESTED_ARGS=(--nested --wayland)
fi
mkdir -p "$PREVIEW_DIR/config"

cat <<EOF

Starting a nested GNOME Shell. ${bold}Close its window to stop the preview.${reset}
Source Glance is enabled automatically; look for its icon in the nested top bar.
Signing in may not work in the nested session; use --session to test sign-in.
Logs are written to $PREVIEW_DIR/shell.log

EOF

# Settings live in a keyfile under $PREVIEW_DIR, so enabling the extension here
# doesn't change which extensions your real session loads.
export GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME="$PREVIEW_DIR/config"
export UUID PREVIEW_DIR NESTED_ARGS_STR="${NESTED_ARGS[*]}"

dbus-run-session -- bash -c '
    # shellcheck disable=SC2086
    gnome-shell $NESTED_ARGS_STR > "$PREVIEW_DIR/shell.log" 2>&1 &
    pid=$!
    for _ in $(seq 1 30); do
        gnome-extensions info "$UUID" >/dev/null 2>&1 && break
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
    done
    gnome-extensions enable "$UUID" 2>/dev/null \
        || echo "Could not enable Source Glance automatically. In the nested window run: gnome-extensions enable $UUID"
    wait "$pid"
' || true

echo "Preview ended. Errors, if any, are in $PREVIEW_DIR/shell.log"
