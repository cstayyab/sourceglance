// sourceglance's loader for GNOME Shell, installed by Setup. Runs the installed version from
// versions/<version>/ (see loader.js), so updates apply without logging out.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {currentVersion, versionMetadata} from './loader.js';

export default class SourceglanceLoader extends Extension {
    async enable() {
        const version = currentVersion(this.dir);
        const {default: Build} = await import(`./versions/${version}/extension.js`);
        this._build = new Build(versionMetadata(this.metadata, version));
        await this._build.enable();
    }

    disable() {
        this._build?.disable();
        this._build = null;
    }
}
