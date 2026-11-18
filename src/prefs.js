// Source Glance's window when GNOME's Extensions app opens it (the Settings button there).
// Source Glance itself opens the same window in its own app (launcher.js), so the dock shows
// it as Source Glance rather than Extensions.
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {fillWindow} from './window/app.js';

export default class SourceglancePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        fillWindow(window, {settings: this.getSettings(), dir: this.dir, version: this.metadata['version-name'] ?? 'dev'});
    }
}
