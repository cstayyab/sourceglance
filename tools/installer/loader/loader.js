// Installed by Setup next to extension.js and prefs.js; shared by both. Says which version of
// sourceglance to run: Setup installs each version into versions/<version>/ and writes the
// version to versions/current.
//
// GNOME Shell caches ES modules by URL, so new code at an old URL only runs after a new login.
// Importing each version from its own folder gives it a new URL: after an update, Setup turns
// sourceglance off and on and the new version runs straight away. Keep these loader files
// small and stable; a change to them still needs a new login to take effect.
import GLib from 'gi://GLib';

const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

/** The installed version ("0.3.0") from versions/current. Throws if it's missing or odd. */
export function currentVersion(dir) {
    const [, bytes] = GLib.file_get_contents(dir.get_child('versions').get_child('current').get_path());
    const version = new TextDecoder().decode(bytes).trim();
    if (!VERSION_RE.test(version))
        throw new Error(`sourceglance: unexpected version "${version}" in versions/current`);
    return version;
}

/**
 * Metadata for a version: GNOME Shell's (read at login) updated from that version's own
 * metadata.json, with dir and path pointing at versions/<version>.
 */
export function versionMetadata(metadata, version) {
    const dir = metadata.dir.get_child('versions').get_child(version);
    let own;
    try {
        const [, bytes] = GLib.file_get_contents(dir.get_child('metadata.json').get_path());
        own = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        own = {};
    }
    return {...metadata, ...own, uuid: metadata.uuid, dir, path: dir.get_path()};
}
