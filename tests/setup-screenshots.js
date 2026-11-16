/* global print, logError */
// Dev aid: render every setup wizard page to PNG (run inside a headless GNOME Shell).
//   WAYLAND_DISPLAY=… gjs -m tests/setup-screenshots.js OUT_DIR
// Drives a real install and remove, so run it with isolated XDG_* dirs (see docs/development.md).
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

import {Wizard} from '../tools/installer/lib/wizard.js';

const OUT = System.programArgs[0] ?? '.';
GLib.mkdir_with_parents(OUT, 0o755);
const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => r() ?? GLib.SOURCE_REMOVE));

async function shot(wizard, name) {
    await sleep(400);
    const win = wizard.window;
    const paintable = new Gtk.WidgetPaintable({widget: win});
    const w = win.get_width(), h = win.get_height();
    const snapshot = new Gtk.Snapshot();
    paintable.snapshot(snapshot, w, h);
    const node = snapshot.to_node();
    const texture = win.get_native().get_renderer().render_texture(node, null);
    texture.save_to_png(`${OUT}/${name}.png`);
    print(`saved ${name}.png (${wizard.currentId})`);
}

async function until(fn) {
    for (let i = 0; i < 100 && !fn(); i++)
        await sleep(100);
}

async function drive(app) {
    let wiz = new Wizard(app, {});
    wiz.present();
    await shot(wiz, '01-welcome');
    wiz._next(); await shot(wiz, '02-license');
    wiz.acceptRadio.active = true; await shot(wiz, '03-license-accepted');
    wiz._next(); await shot(wiz, '04-risks');
    wiz._next(); await shot(wiz, '05-options');
    wiz._next(); await until(() => wiz.checks); await shot(wiz, '06-check');
    wiz._next(); await shot(wiz, '07-ready');
    wiz._next(); await until(() => wiz.currentId !== 'progress'); await shot(wiz, '08-done');
    wiz.finished = true; wiz.window.close();

    wiz = new Wizard(app, {});
    wiz.present();
    await shot(wiz, '09-maintenance');
    wiz.window.close();
    wiz = new Wizard(app, {preselect: 'remove'});
    wiz.present();
    wiz._next(); await shot(wiz, '10-remove-options');
    wiz._next(); await shot(wiz, '11-ready-remove');
    wiz._next(); await until(() => wiz.currentId !== 'progress'); await shot(wiz, '12-removed');
    wiz.finished = true; wiz.window.close();
}

Adw.init();
const app = new Adw.Application({application_id: 'io.github.omer_gh.SourceglanceSetupShots', flags: Gio.ApplicationFlags.NON_UNIQUE});
app.connect('activate', () => {
    app.hold();
    drive(app).catch(e => logError(e)).finally(() => app.release());
});
app.run([]);
