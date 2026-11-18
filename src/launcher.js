// Source Glance's own app (`gjs -m launcher.js`), outside GNOME Shell. Its app ID matches the
// app grid launcher (appLauncher.js), so the dock and Alt+Tab show its window as Source Glance.
// From the app icon it shows a splash window while it makes sure Source Glance is on, shows it
// again if you chose Quit, then opens the window. `--open` (from the top bar) opens the window
// straight away. Only one copy runs: opening it again shows the window that's already open.
import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Gettext from 'gettext';
import System from 'system';

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

// The extension's settings, from the compiled schema next to this file (as GNOME Shell reads
// it), or from the system's schemas if there's none here.
function extensionSettings() {
    let source = Gio.SettingsSchemaSource.get_default();
    const local = HERE.get_child('schemas');
    if (local.get_child('gschemas.compiled').query_exists(null))
        source = Gio.SettingsSchemaSource.new_from_directory(local.get_path(), source, false);
    const schema = source?.lookup(SCHEMA, true);
    if (!schema)
        throw new Error(`schema ${SCHEMA} not found`);
    return new Gio.Settings({settings_schema: schema});
}

// Ask a running sourceglance to show itself (see "start-request" in the schema).
function requestStart(settings) {
    try {
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
    box.append(new Gtk.Label({label: 'Source Glance', css_classes: ['title-1']}));
    box.append(new Gtk.Label({label: `${version()}  ·  GitHub issues, pull requests and projects at a glance`,
        css_classes: ['dim-label'], wrap: true, justify: Gtk.Justification.CENTER}));
    const progress = new Gtk.ProgressBar({margin_top: 14});
    const step = new Gtk.Label({css_classes: ['caption', 'dim-label']});
    box.append(progress);
    box.append(step);

    const win = new Adw.Window({
        application: app,
        title: 'Source Glance',
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

// Uses the extension's gettext domain, like GNOME Shell does for it (window/i18n.js).
function initTranslations() {
    const locale = HERE.get_child('locale');
    if (locale.query_exists(null))
        Gettext.bindtextdomain(UUID, locale.get_path());
}

async function openWindow(app, settings) {
    // Imported now, not at the top, so the versioned Gtk and Adw above are loaded first.
    const {fillWindow} = await import('./window/app.js');
    const win = new Adw.ApplicationWindow({application: app, title: 'Source Glance'});
    try {
        fillWindow(win, {settings, dir: HERE, version: version() || 'dev'});
    } catch (e) {
        win.destroy();
        throw e;
    }
    win.present();
    return win;
}

// The window uses String.prototype.format, as in GNOME's Extensions app, which sets it up the same way.
globalThis.imports.package.initFormat();

const quick = System.programArgs.includes('--open');
const app = new Adw.Application({application_id: 'io.github.omer_gh.sourceglance'});
let main = null;
let opening = false;
app.connect('activate', async () => {
    if (main) {
        main.present();
        return;
    }
    if (opening)
        return;
    opening = true;
    app.hold();
    try {
        initTranslations();
        const settings = extensionSettings();
        if (quick) {
            main = await openWindow(app, settings);
        } else {
            const splash = buildSplash(app);
            splash.win.present();
            const started = GLib.get_monotonic_time();

            splash.setStep('Turning Source Glance on…', 0.2);
            await run(['gnome-extensions', 'enable', UUID]);
            splash.setStep('Starting…', 0.5);
            requestStart(settings);

            // Keep the splash up for a moment before the main window covers it.
            const shown = (GLib.get_monotonic_time() - started) / 1000;
            await wait(Math.max(0, MIN_SPLASH_MS - shown));
            splash.setStep('Opening Source Glance…', 0.9);
            main = await openWindow(app, settings);
            splash.win.close();
        }
        main.connect('close-request', () => {
            main = null;
            return false;
        });
    } catch (e) {
        printerr(`sourceglance: couldn't open the window: ${e.message}`);
        for (const win of app.get_windows())
            win.destroy();
    } finally {
        opening = false;
        app.release();
    }
});
app.run([]);
