// Settings → System Start: starting with your session, the app icon, and Start now.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

/** `ctx` is {settings, toast}. */
export function buildSystemStartPage({settings, toast}) {
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({title: _('Startup')});
    page.add(group);

    const autostartRow = new Adw.SwitchRow({
        title: _('Start automatically'),
        subtitle: _('Show Source Glance in the top bar when you log in'),
    });
    settings.bind('start-automatically', autostartRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(autostartRow);

    const launcherRow = new Adw.SwitchRow({
        title: _('Show in app grid'),
        subtitle: _('An app icon that starts Source Glance and opens this window'),
    });
    settings.bind('app-launcher', launcherRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(launcherRow);

    // After Quit, this is the way back without logging out.
    const startRow = new Adw.ActionRow({
        title: _('Start now'),
        subtitle: _('Show Source Glance in the top bar again after you chose Quit'),
    });
    const startButton = new Gtk.Button({label: _('Start'), valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
    startButton.connect('clicked', () => {
        settings.set_int('start-request', settings.get_int('start-request') + 1);
        toast(_('Source Glance is starting'));
    });
    startRow.add_suffix(startButton);
    group.add(startRow);

    const updates = new Adw.PreferencesGroup({
        title: _('Updates'),
        description: _('Source Glance asks GitHub for its newest release; nothing about you is sent. One Setup file installs, updates, repairs and removes Source Glance.'),
    });
    const updatesRow = new Adw.SwitchRow({
        title: _('Check for updates'),
        subtitle: _('When a newer version is out, say so when you log in and show “Update available” in the title bar'),
    });
    settings.bind('check-updates', updatesRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    updates.add(updatesRow);
    page.add(updates);

    return page;
}
