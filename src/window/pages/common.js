// Small pieces shared by the window's list pages.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

/** A flat button with an icon (theme name or Gio.Icon) and a label. */
export function actionButton({iconName = null, gicon = null, label, onClick}) {
    const box = new Gtk.Box({spacing: 6});
    box.append(gicon ? new Gtk.Image({gicon}) : new Gtk.Image({icon_name: iconName}));
    box.append(new Gtk.Label({label, ellipsize: 3 /* END */, max_width_chars: 28}));
    const button = new Gtk.Button({child: box, css_classes: ['sourceglance-action']});
    button.connect('clicked', onClick);
    return button;
}

/**
 * What to show instead of a list: {icon, title, description}, or null when the list can
 * show (loaded, possibly with a stale error).
 */
export function statusText(state) {
    if (state.status === 'signed-out') {
        return {icon: 'avatar-default-symbolic', title: _('Not signed in'),
            description: _('Sign in under Settings → Accounts.')};
    }
    if (state.updatedAt === null && state.status !== 'error')
        return {icon: 'content-loading-symbolic', title: _('Loading…'), description: ''};
    if (state.updatedAt === null && state.status === 'error') {
        return {icon: 'network-error-symbolic', title: _('Couldn’t load your lists'),
            description: state.error?.kind === 'network'
                ? _('Couldn’t reach GitHub. Check your connection.')
                : _('GitHub returned an error. Source Glance will try again soon.')};
    }
    return null;
}

/** "Nothing matches" for a search, with a button that clears it to show the full list again. */
export function noMatchesGroup(query, onClear) {
    const group = new Adw.PreferencesGroup();
    const row = new Adw.ActionRow({title: _('Nothing matches “%s”').format(query), use_markup: false});
    row.add_prefix(new Gtk.Image({icon_name: 'edit-find-symbolic'}));
    const clear = new Gtk.Button({label: _('Clear search'), valign: Gtk.Align.CENTER});
    clear.connect('clicked', onClear);
    row.add_suffix(clear);
    group.add(row);
    return group;
}
