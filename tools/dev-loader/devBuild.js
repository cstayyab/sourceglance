// Development only, installed by tools/dev-reload.sh next to the dev loaders; never shipped.
// Shared by extension.js (GNOME Shell) and prefs.js (the window's process), so it uses GLib only.
import GLib from 'gi://GLib';

/** The newest build's stamp, written by dev-reload.sh. */
export function currentBuild(dir) {
    const [, bytes] = GLib.file_get_contents(dir.get_child('dev').get_child('current').get_path());
    return new TextDecoder().decode(bytes).trim();
}

/**
 * Metadata for a build: ours (read by GNOME Shell at login, so possibly an older version)
 * updated from the build's own metadata.json, with dir/path pointing at dev/<stamp>.
 * Without this, the window would show the old version and offer an update to the new one.
 */
export function buildMetadata(metadata, stamp) {
    const dir = metadata.dir.get_child('dev').get_child(stamp);
    let own;
    try {
        const [, bytes] = GLib.file_get_contents(dir.get_child('metadata.json').get_path());
        own = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        own = {};
    }
    return {...metadata, ...own, uuid: metadata.uuid, dir, path: dir.get_path()};
}
