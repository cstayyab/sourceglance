// Development loader, installed by tools/dev-reload.sh (`make reload`); never shipped.
//
// GNOME Shell caches ES modules by URL, so on Wayland new code normally needs a new login.
// dev-reload.sh copies each build to dev/<stamp>/ and toggles the extension; this loader then
// imports that build from its new URL, so the latest code runs without logging out.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {buildMetadata, currentBuild} from './devBuild.js';

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
