// sourceglance's loader for its window, installed by Setup. Opens the installed version from
// versions/<version>/ (see loader.js).
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {currentVersion, versionMetadata} from './loader.js';

export default class SourceglancePrefsLoader extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const version = currentVersion(this.dir);
        const {default: Build} = await import(`./versions/${version}/prefs.js`);
        const build = new Build(versionMetadata(this.metadata, version));
        await build.fillPreferencesWindow(window);
    }
}
