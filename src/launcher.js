// What the sourceglance app icon runs (`gjs -m launcher.js`), outside GNOME Shell: makes sure
// sourceglance is on, shows it again if you chose Quit, and opens its Settings.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const UUID = 'sourceglance@omer-gh.github.io';
const SCHEMA = 'org.gnome.shell.extensions.sourceglance';

function run(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE).wait(null);
    } catch (e) {
        printerr(`sourceglance: ${argv.join(' ')} failed: ${e.message}`);
    }
}

// Ask a running sourceglance to show itself (see "start-request" in the schema). Without a
// compiled schema next to this file, opening Settings still works.
function requestStart() {
    const schemas = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('schemas');
    try {
        const source = Gio.SettingsSchemaSource.new_from_directory(schemas.get_path(),
            Gio.SettingsSchemaSource.get_default(), false);
        const settings = new Gio.Settings({settings_schema: source.lookup(SCHEMA, false)});
        settings.set_int('start-request', settings.get_int('start-request') + 1);
        Gio.Settings.sync();
    } catch (e) {
        printerr(`sourceglance: couldn't ask it to start: ${e.message}`);
    }
}

run(['gnome-extensions', 'enable', UUID]);
requestStart();
run(['gnome-extensions', 'prefs', UUID]);
// Let the D-Bus calls above finish before exiting.
GLib.usleep(200000);
