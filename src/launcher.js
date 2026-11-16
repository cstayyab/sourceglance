// What the sourceglance app icon runs (`gjs -m launcher.js`), outside GNOME Shell. It shows a
// splash window while it makes sure sourceglance is on, shows it again if you chose Quit, and
// opens the sourceglance window.
import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const UUID = 'sourceglance@omer-gh.github.io';
const SCHEMA = 'org.gnome.shell.extensions.sourceglance';
const HERE = Gio.File.new_for_uri(import.meta.url).get_parent();
// Long enough to read, short enough not to be in the way.
const MIN_SPLASH_MS = 1200;

Gio._promisify(Gio.Subprocess.prototype, 'wait_async');

function version() {
    try {
        const [, bytes] = GLib.file_get_contents(HERE.get_child('metadata.json').get_path());
        return JSON.parse(new TextDecoder().decode(bytes))['version-name'] ?? '';
    } catch {
        return '';
    }
}

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

async function run(argv) {
    try {
        await Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE).wait_async(null);
    } catch (e) {
        printerr(`sourceglance: ${argv.join(' ')} failed: ${e.message}`);
    }
}

// Ask a running sourceglance to show itself (see "start-request" in the schema). Without a
// compiled schema next to this file, opening the window still works.
function requestStart() {
    try {
        const source = Gio.SettingsSchemaSource.new_from_directory(HERE.get_child('schemas').get_path(),
            Gio.SettingsSchemaSource.get_default(), false);
        const settings = new Gio.Settings({settings_schema: source.lookup(SCHEMA, false)});
        settings.set_int('start-request', settings.get_int('start-request') + 1);
        Gio.Settings.sync();
    } catch (e) {
        printerr(`sourceglance: couldn't ask it to start: ${e.message}`);
    }
}

function buildSplash(app) {
    const provider = new Gtk.CssProvider();
    provider.load_from_path(HERE.get_child('window').get_child('theme.css').get_path());
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10, valign: Gtk.Align.CENTER,
        margin_top: 28, margin_bottom: 24, margin_start: 32, margin_end: 32});
    box.append(new Gtk.Image({file: HERE.get_child('icons').get_child('sourceglance-app.svg').get_path(), pixel_size: 96}));
    box.append(new Gtk.Label({label: 'sourceglance', css_classes: ['title-1']}));
    box.append(new Gtk.Label({label: `${version()}  ·  GitHub issues, pull requests and projects at a glance`,
        css_classes: ['dim-label'], wrap: true, justify: Gtk.Justification.CENTER}));
    const progress = new Gtk.ProgressBar({margin_top: 14});
    const step = new Gtk.Label({css_classes: ['caption', 'dim-label']});
    box.append(progress);
    box.append(step);

    const win = new Adw.Window({
        application: app,
        title: 'sourceglance',
        content: box,
        default_width: 480,
        default_height: 300,
        resizable: false,
    });
    // Added, not set: replacing css_classes would drop the window's own 'background' class.
    win.add_css_class('sourceglance-window');
    win.add_css_class('sourceglance-splash');
    return {win, setStep(text, fraction) {
        step.label = text;
        progress.fraction = fraction;
    }};
}

const app = new Adw.Application({application_id: 'io.github.omer_gh.sourceglance.Launcher',
    flags: Gio.ApplicationFlags.NON_UNIQUE});
app.connect('activate', async () => {
    app.hold();
    const splash = buildSplash(app);
    splash.win.present();
    const started = GLib.get_monotonic_time();

    splash.setStep('Turning sourceglance on…', 0.2);
    await run(['gnome-extensions', 'enable', UUID]);
    splash.setStep('Starting…', 0.5);
    requestStart();

    // Keep the splash up for a moment before the main window covers it.
    const shown = (GLib.get_monotonic_time() - started) / 1000;
    await wait(Math.max(0, MIN_SPLASH_MS - shown));
    splash.setStep('Opening sourceglance…', 0.9);
    await run(['gnome-extensions', 'prefs', UUID]);
    splash.setStep('Ready', 1);
    await wait(300);
    splash.win.close();
    app.release();
});
app.run([]);
