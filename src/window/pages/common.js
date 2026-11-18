// Small pieces shared by the window's list pages.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
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

/**
 * A group whose heading (disclosure arrow, title, item count) collapses or expands it. The
 * caller adds the rows only when not `collapsed`. `toggleable` is false while a search expands
 * every group; `suffix` is an optional widget after the heading (e.g. Open board). `onToggle`
 * runs after the click's signal, since the caller usually rebuilds the page.
 */
export function collapsibleGroup({title, count, collapsed, toggleable = true, suffix = null, onToggle}) {
    const group = new Adw.PreferencesGroup();
    const heading = new Gtk.Box({spacing: 6});
    heading.append(new Gtk.Image({icon_name: collapsed ? 'pan-end-symbolic' : 'pan-down-symbolic'}));
    heading.append(new Gtk.Label({label: title, xalign: 0, hexpand: true, ellipsize: 3 /* END */,
        css_classes: ['heading']}));
    heading.append(new Gtk.Label({label: String(count), css_classes: ['sourceglance-count-pill'], valign: Gtk.Align.CENTER}));
    const toggle = new Gtk.Button({child: heading, hexpand: true, sensitive: toggleable,
        css_classes: ['flat', 'sourceglance-group-toggle'],
        tooltip_text: !toggleable ? _('Clear the search to collapse') : collapsed ? _('Show') : _('Hide')});
    toggle.update_property([Gtk.AccessibleProperty.LABEL], [title]);
    // GJS passes this state as an int, not a boolean.
    toggle.update_state([Gtk.AccessibleState.EXPANDED], [collapsed ? 0 : 1]);
    toggle.connect('clicked', () => {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            onToggle();
            return GLib.SOURCE_REMOVE;
        });
    });
    if (suffix) {
        const box = new Gtk.Box({spacing: 6, hexpand: true});
        box.append(toggle);
        box.append(suffix);
        group.set_header_suffix(box);
    } else {
        group.set_header_suffix(toggle);
    }
    return group;
}
