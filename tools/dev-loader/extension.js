// Development loader, installed by tools/dev-reload.sh (`make reload`); never shipped.
//
// GNOME Shell caches ES modules by URL, so on Wayland new code normally needs a new login.
// dev-reload.sh copies each build to dev/<stamp>/ and toggles the extension; this loader then
// imports that build from its new URL, so the latest code runs without logging out.
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

/** The newest build's stamp, written by dev-reload.sh. */
export function currentBuild(dir) {
    const [, bytes] = GLib.file_get_contents(dir.get_child('dev').get_child('current').get_path());
    return new TextDecoder().decode(bytes).trim();
}

/** Metadata for a build: same as ours, but dir/path point at dev/<stamp>. */
export function buildMetadata(metadata, stamp) {
    const dir = metadata.dir.get_child('dev').get_child(stamp);
    return {...metadata, dir, path: dir.get_path()};
}

export default class DevLoader extends Extension {
    async enable() {
        const stamp = currentBuild(this.dir);
        const {default: Build} = await import(`./dev/${stamp}/extension.js`);
        this._build = new Build(buildMetadata(this.metadata, stamp));
        await this._build.enable();
        console.log(`sourceglance: dev build ${stamp} enabled`);
    }

    disable() {
        this._build?.disable();
        this._build = null;
    }
}
