// Development loader for Settings, installed by tools/dev-reload.sh; never shipped.
// Opens Settings from the newest build in dev/<stamp>/ (see extension.js here).
import GLib from 'gi://GLib';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DevPrefsLoader extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const [, bytes] = GLib.file_get_contents(this.dir.get_child('dev').get_child('current').get_path());
        const stamp = new TextDecoder().decode(bytes).trim();
        const {default: Build} = await import(`./dev/${stamp}/prefs.js`);
        const dir = this.dir.get_child('dev').get_child(stamp);
        const build = new Build({...this.metadata, dir, path: dir.get_path()});
        await build.fillPreferencesWindow(window);
    }
}
