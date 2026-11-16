// Development loader for Settings, installed by tools/dev-reload.sh; never shipped.
// Opens Settings from the newest build in dev/<stamp>/ (see extension.js here).
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {buildMetadata, currentBuild} from './devBuild.js';

export default class DevPrefsLoader extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const stamp = currentBuild(this.dir);
        const {default: Build} = await import(`./dev/${stamp}/prefs.js`);
        const build = new Build(buildMetadata(this.metadata, stamp));
        await build.fillPreferencesWindow(window);
    }
}
