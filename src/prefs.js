import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SourceglancePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('GitHub'),
            description: _('Token sign-in is coming in v0.1.0. Tokens will be stored in the GNOME keyring.'),
        });
        page.add(group);

        const reposRow = new Adw.EntryRow({
            title: _('Repositories to watch (owner/name, comma-separated)'),
            text: settings.get_strv('repositories').join(', '),
        });
        reposRow.connect('changed', () => {
            const repos = reposRow.get_text()
                .split(',')
                .map(r => r.trim())
                .filter(r => r.length > 0);
            settings.set_strv('repositories', repos);
        });
        group.add(reposRow);

        const intervalRow = new Adw.SpinRow({
            title: _('Refresh interval'),
            subtitle: _('Minutes between checks'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 120, step_increment: 1}),
        });
        settings.bind('refresh-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(intervalRow);
    }
}
