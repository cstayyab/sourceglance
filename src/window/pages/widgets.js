// Settings → Desktop Widgets: which cards show on the desktop, and how.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {normalizeWidgets} from '../../lib/model.js';

/** `ctx` is {settings, toast}. */
export function buildWidgetsPage({settings, toast}) {
    const page = new Adw.PreferencesPage();
    const cards = new Adw.PreferencesGroup({
        title: _('Cards on the desktop'),
        description: _('Cards sit on the desktop, below your windows. Drag a card by its header to move it.'),
    });
    page.add(cards);
    for (const [id, title, subtitle] of [
        ['summary', _('Summary'), _('All counts, including closed and merged items still assigned to you')],
        ['issues', _('Issues'), _('Open issues assigned to you')],
        ['prs', _('Pull requests'), _('Assigned to you or awaiting your review')],
        ['projects', _('Projects'), _('Draft items on your project boards')],
    ]) {
        const row = new Adw.SwitchRow({
            title,
            subtitle,
            active: normalizeWidgets(settings.get_strv('widgets')).includes(id),
        });
        row.connect('notify::active', () => {
            const current = normalizeWidgets(settings.get_strv('widgets'));
            const next = row.active ? [...current, id] : current.filter(other => other !== id);
            settings.set_strv('widgets', normalizeWidgets(next));
        });
        cards.add(row);
    }

    const look = new Adw.PreferencesGroup({title: _('Appearance')});
    page.add(look);
    const opacity = new Adw.SpinRow({
        title: _('Opacity'),
        subtitle: _('Percent'),
        adjustment: new Gtk.Adjustment({lower: 30, upper: 100, step_increment: 5}),
    });
    settings.bind('widget-opacity', opacity, 'value', Gio.SettingsBindFlags.DEFAULT);
    look.add(opacity);

    const reset = new Adw.ActionRow({title: _('Reset positions'), subtitle: _('Put every card back in the column on the right')});
    const resetButton = new Gtk.Button({label: _('Reset'), valign: Gtk.Align.CENTER});
    resetButton.connect('clicked', () => {
        settings.reset('widget-positions');
        toast(_('Cards moved back'));
    });
    reset.add_suffix(resetButton);
    look.add(reset);
    return page;
}
