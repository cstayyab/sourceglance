// Panel indicator and menu. A pure view: render(state) redraws everything (see docs/design/v0.1-ui.md).
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {countLabel, isSafeGitHubUrl, relativeTime, truncate} from './model.js';

const VIEW_ALL_URL = 'https://github.com/issues/assigned';

function formatRelative(date) {
    const {unit, value} = relativeTime(date);
    switch (unit) {
    case 'now':
        return _('just now');
    case 'minute':
        return ngettext('%d min ago', '%d min ago', value).format(value);
    case 'hour':
        return ngettext('%d hour ago', '%d hours ago', value).format(value);
    default:
        return ngettext('%d day ago', '%d days ago', value).format(value);
    }
}

function formatClock(ms) {
    return GLib.DateTime.new_from_unix_local(Math.floor(ms / 1000)).format('%H:%M');
}

function errorText(error, intervalMinutes) {
    switch (error.kind) {
    case 'auth':
        return _('Your token was rejected. Update it in Settings.');
    case 'forbidden':
        return _('Your token can’t read these issues. Check its permissions in Settings.');
    case 'rate-limit':
        return error.retryAt
            ? _('GitHub rate limit reached. Retrying at %s.').format(formatClock(error.retryAt))
            : _('GitHub rate limit reached. Retrying later.');
    case 'query':
        return _('A watched repository doesn’t exist or isn’t visible to your token. Check Settings.');
    default:
        return ngettext('Couldn’t reach GitHub. Retrying in %d min.',
            'Couldn’t reach GitHub. Retrying in %d min.', intervalMinutes).format(intervalMinutes);
    }
}

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init({onRefresh, onSettings}) {
        super._init(0.0, 'sourceglance');
        this._onRefresh = onRefresh;
        this._onSettings = onSettings;
        this._state = null;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({
            icon_name: 'checkbox-checked-symbolic',
            style_class: 'system-status-icon',
        });
        this._count = new St.Label({
            style_class: 'sourceglance-count',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        box.add_child(this._icon);
        box.add_child(this._count);
        this.add_child(box);

        // Rebuild on open so "updated N min ago" is current.
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open && this._state)
                this._rebuildMenu();
        });
    }

    render(state) {
        this._state = state;
        this._updatePanel();
        this._rebuildMenu();
    }

    _hasList() {
        const {status, groups} = this._state;
        return status === 'ready' || (status === 'error' && groups.length > 0);
    }

    _updatePanel() {
        const {status, total, shown} = this._state;
        const label = this._hasList() ? countLabel(total, shown) : '';
        this._count.text = label;
        this._count.visible = label !== '';
        this._icon.opacity = status === 'error' ? 128 : 255;

        let name;
        if (status === 'signed-out')
            name = _('sourceglance: not signed in');
        else if (label)
            name = ngettext('sourceglance: %s assigned issue', 'sourceglance: %s assigned issues', total).format(label);
        else
            name = 'sourceglance';
        this.accessible_name = name;
    }

    _headerText() {
        const {status, login, refreshing, updatedAt} = this._state;
        if (status === 'signed-out')
            return _('Sign in to see your GitHub issues');
        if (!login)
            return status === 'error' ? _('GitHub issues') : _('Loading issues…');
        if (refreshing)
            return _('@%s · Refreshing…').format(login);
        if (updatedAt)
            return _('@%s · updated %s').format(login, formatRelative(updatedAt));
        return `@${login}`;
    }

    _addInfo(text, styleClass) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
        item.label.clutter_text.line_wrap = true;
        item.label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        item.add_style_class_name(styleClass);
        this.menu.addMenuItem(item);
        return item;
    }

    _addAction(text, callback) {
        const item = new PopupMenu.PopupMenuItem(text);
        item.connect('activate', callback);
        this.menu.addMenuItem(item);
        return item;
    }

    _openUri(uri) {
        if (!isSafeGitHubUrl(uri)) {
            console.warn('sourceglance: refusing to open a non-GitHub link');
            return;
        }
        try {
            Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
        } catch (e) {
            console.error(`sourceglance: could not open ${uri}`, e);
        }
    }

    _rebuildMenu() {
        const state = this._state;
        this.menu.removeAll();

        this._addInfo(this._headerText(), 'sourceglance-header');
        if (state.status === 'error')
            this._addInfo(errorText(state.error, state.intervalMinutes), 'sourceglance-message');

        const signedIn = state.status === 'ready' || state.status === 'error';
        if (this._hasList()) {
            if (state.total === 0) {
                this._addInfo(_('No open issues assigned to you'), 'sourceglance-message');
                // Read-only sign-ins silently hide repositories they weren't granted.
                this._addInfo(_('Missing some? sourceglance only sees the repositories you ' +
                    'gave it. Check Settings.'), 'sourceglance-hint');
            } else {
                for (const group of state.groups) {
                    this._addInfo(group.repo, 'sourceglance-repo');
                    for (const issue of group.issues) {
                        const item = this._addAction(`#${issue.number}  ${truncate(issue.title)}`,
                            () => this._openUri(issue.url));
                        item.add_style_class_name('sourceglance-issue');
                    }
                }
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (signedIn) {
            const viewAll = state.total > state.shown
                ? _('View all %d on GitHub').format(state.total)
                : _('View all on GitHub');
            this._addAction(viewAll, () => this._openUri(VIEW_ALL_URL));
            const refresh = this._addAction(_('Refresh'), () => this._onRefresh());
            refresh.setSensitive(!state.refreshing);
        }
        this._addAction(_('Settings'), () => this._onSettings());
    }
});
