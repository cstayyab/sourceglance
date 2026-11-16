// The app grid / dock icon: a desktop entry in ~/.local/share/applications that runs
// launcher.js. The extension writes it on enable (so it works however sourceglance was
// installed) and removes it when "Show in app grid" is turned off in Settings.
import GLib from 'gi://GLib';

import {LAUNCHER_ID, launcherDesktopEntry} from './model.js';

function desktopFilePath() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'applications', `${LAUNCHER_ID}.desktop`]);
}

/** Writes the launcher if it's missing or out of date. `dir` is the extension's Gio.File. */
export function installLauncher(dir) {
    const entry = launcherDesktopEntry({
        launcherPath: dir.get_child('launcher.js').get_path(),
        iconPath: dir.get_child('icons').get_child('sourceglance-app.svg').get_path(),
    });
    const path = desktopFilePath();
    try {
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            const [, bytes] = GLib.file_get_contents(path);
            if (new TextDecoder().decode(bytes) === entry)
                return;
        }
        GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
        GLib.file_set_contents(path, entry);
    } catch (e) {
        console.warn(`sourceglance: couldn't add the app icon: ${e.message}`);
    }
}

/** Removes the launcher this extension wrote, if any. */
export function removeLauncher() {
    const path = desktopFilePath();
    try {
        if (GLib.file_test(path, GLib.FileTest.EXISTS))
            GLib.unlink(path);
    } catch (e) {
        console.warn(`sourceglance: couldn't remove the app icon: ${e.message}`);
    }
}
