#!/usr/bin/env bash
# Build the MSI-style setup wizard as AppImages (ADR 0005, docs/design/installer.md).
#
#   tools/build-setup.sh                 # dist/sourceglance-Setup-<version>-<arch>.AppImage
#   tools/build-setup.sh payload DIR     # only stage the payload (for `make setup-run`)
#
# Needs: mksquashfs (squashfs-tools), glib-compile-schemas, sha256sum, curl.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=$(sed -n 's/.*"version-name": *"\([^"]*\)".*/\1/p' "$ROOT/src/metadata.json")
ARCHES=${ARCHES:-"x86_64 aarch64"}

# AppImage runtime, pinned and verified (threat model T19).
RUNTIME_RELEASE=20251108
declare -A RUNTIME_SHA256=(
    [x86_64]=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d
    [aarch64]=00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444
)
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/sourceglance-build"

# Stage the extension in its installed layout (tools/installer/loader/loader.js): a small
# loader at the top, this version in versions/<version>/, and versions/current naming it.
# The top level also keeps metadata.json, stylesheet.css and schemas/, which GNOME Shell reads
# from there, and icons/, so a version still running from before an update keeps its icons.
# Then write a SHA-256 manifest of every file.
stage_payload() {
    local dest=$1 ext="$1/extension"
    mkdir -p "$ext/versions/$VERSION"
    cp -R "$ROOT/src/." "$ext/versions/$VERSION/"
    glib-compile-schemas "$ext/versions/$VERSION/schemas"
    printf '%s\n' "$VERSION" > "$ext/versions/current"
    cp "$ROOT/tools/installer/loader/extension.js" "$ROOT/tools/installer/loader/prefs.js" \
        "$ROOT/tools/installer/loader/loader.js" "$ROOT/src/metadata.json" "$ROOT/src/stylesheet.css" "$ext/"
    cp -R "$ROOT/src/schemas" "$ROOT/src/icons" "$ext/"
    glib-compile-schemas "$ext/schemas"
    (cd "$dest/extension" && find . -type f -print0 | sort -z | sed -z 's|^\./||' | xargs -0 sha256sum) \
        > "$dest/manifest.sha256"
    cp "$ROOT/LICENSE" "$dest/LICENSE"
    cp "$ROOT/tools/installer/data/sourceglance-setup.svg" "$dest/"
}

fetch_runtime() {
    local arch=$1 file="$CACHE/runtime-$arch-$RUNTIME_RELEASE"
    mkdir -p "$CACHE"
    if [[ ! -f $file ]]; then
        curl -fsSL -o "$file.part" \
            "https://github.com/AppImage/type2-runtime/releases/download/$RUNTIME_RELEASE/runtime-$arch"
        mv "$file.part" "$file"
    fi
    echo "${RUNTIME_SHA256[$arch]}  $file" | sha256sum -c --quiet - >&2 \
        || { echo "Checksum mismatch for $file" >&2; exit 1; }
    echo "$file"
}

if [[ ${1:-} == payload ]]; then
    stage_payload "${2:?usage: build-setup.sh payload DIR}"
    echo "Staged payload in $2"
    exit 0
fi

BUILD="$ROOT/dist/setup-build-$VERSION"
if [[ -e $BUILD ]]; then
    echo "$BUILD already exists; move it aside or remove it, then re-run." >&2
    exit 1
fi
APPDIR="$BUILD/AppDir"
SHARE="$APPDIR/usr/share/sourceglance-setup"
mkdir -p "$SHARE"
cp -R "$ROOT/tools/installer/main.js" "$ROOT/tools/installer/lib" "$SHARE/"
stage_payload "$SHARE/payload"
install -m 0755 "$ROOT/tools/installer/data/AppRun" "$APPDIR/AppRun"
cp "$ROOT/tools/installer/data/sourceglance-setup.desktop" "$ROOT/tools/installer/data/sourceglance-setup.svg" "$APPDIR/"
ln -s sourceglance-setup.svg "$APPDIR/.DirIcon"

mksquashfs "$APPDIR" "$BUILD/payload.squashfs" -root-owned -noappend -comp zstd -mkfs-time 0 -all-time 0 -quiet

for arch in $ARCHES; do
    out="$ROOT/dist/sourceglance-Setup-$VERSION-$arch.AppImage"
    cat "$(fetch_runtime "$arch")" "$BUILD/payload.squashfs" > "$out"
    chmod 0755 "$out"
    echo "Built $out"
done
