// Settings → System Tray: how sourceglance looks in the top bar.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {normalizeButtons} from '../../lib/model.js';

/** `ctx` is {settings}. */
export function buildSystemTrayPage({settings}) {
    const page = new Adw.PreferencesPage();

    const group = new Adw.PreferencesGroup({
        title: _('Top bar'),
        description: _('The Source Glance button, with status and Settings, is always shown.'),
    });
    page.add(group);

    const layouts = ['separate', 'tabs'];
    const layoutRow = new Adw.ComboRow({
        title: _('Layout'),
        model: Gtk.StringList.new([_('Separate top-bar icons'), _('Tabs in one menu')]),
        selected: Math.max(0, layouts.indexOf(settings.get_string('layout'))),
    });
    layoutRow.connect('notify::selected', () =>
        settings.set_string('layout', layouts[layoutRow.selected] ?? 'separate'));
    group.add(layoutRow);

    const lists = new Adw.PreferencesGroup({title: _('Lists')});
    page.add(lists);
    for (const [id, title, subtitle] of [
        ['issues', _('Issues'), _('Open issues assigned to you')],
        ['prs', _('Pull requests'), _('Assigned to you or awaiting your review')],
        ['projects', _('Projects'), _('Draft items on your project boards')],
    ]) {
        const row = new Adw.SwitchRow({
            title,
            subtitle,
            active: normalizeButtons(settings.get_strv('toolbar-buttons')).includes(id),
        });
        row.connect('notify::active', () => {
            const current = normalizeButtons(settings.get_strv('toolbar-buttons'));
            const next = row.active ? [...current, id] : current.filter(other => other !== id);
            settings.set_strv('toolbar-buttons', normalizeButtons(next));
        });
        lists.add(row);
    }

    const updates = new Adw.PreferencesGroup({title: _('Updates')});
    page.add(updates);
    const intervalRow = new Adw.SpinRow({
        title: _('Refresh interval'),
        subtitle: _('Minutes between checks'),
        adjustment: new Gtk.Adjustment({lower: 1, upper: 120, step_increment: 1}),
    });
    settings.bind('refresh-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    updates.add(intervalRow);

    return page;
}
