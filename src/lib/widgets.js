// Desktop widgets: cards with your lists, on the desktop below every window. They sit just
// above the desktop-icons window when there is one (Desktop Icons draws the desktop as a
// window), so they stay visible and clickable. Drag a card by its header; positions are saved.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    WIDGET_WIDTH,
    clampWidgetPosition,
    defaultWidgetPosition,
    isDoneStatus,
    itemRef,
    listBadge,
    normalizeWidgets,
    relativeTime,
    searchPageUrl,
    truncate,
} from './model.js';
import {openUri} from './views.js';

const MAX_ROWS = 8;

/** The window Desktop Icons (or another desktop app) draws the desktop with. */
function isDesktopWindow(metaWindow) {
    return metaWindow.get_window_type() === Meta.WindowType.DESKTOP;
}

function updatedText(state) {
    if (state.status === 'signed-out')
        return _('Not signed in');
    if (!state.updatedAt)
        return _('Loading…');
    const {unit, value} = relativeTime(state.updatedAt);
    if (unit === 'now')
        return _('Updated just now');
    if (unit === 'minute')
        return ngettext('Updated %d min ago', 'Updated %d min ago', value).format(value);
    if (unit === 'hour')
        return ngettext('Updated %d hour ago', 'Updated %d hours ago', value).format(value);
    return ngettext('Updated %d day ago', 'Updated %d days ago', value).format(value);
}

class Card {
    constructor({id, title, gicon, onDragEnd}) {
        this.id = id;
        this._onDragEnd = onDragEnd;
        this.actor = new St.BoxLayout({style_class: 'sourceglance-widget', reactive: true, width: WIDGET_WIDTH});
        // GNOME 48 replaced St.BoxLayout's `vertical` with `orientation`.
        if ('orientation' in this.actor)
            this.actor.orientation = Clutter.Orientation.VERTICAL;
        else
            this.actor.vertical = true;

        this._header = new St.BoxLayout({style_class: 'sourceglance-widget-header', reactive: true, track_hover: true});
        this._header.add_child(new St.Icon({gicon, style_class: 'sourceglance-widget-icon'}));
        this._header.add_child(new St.Label({text: title, x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        this._count = new St.Label({style_class: 'sourceglance-widget-count', y_align: Clutter.ActorAlign.CENTER});
        this._header.add_child(this._count);
        this.actor.add_child(this._header);

        this._body = new St.BoxLayout({style_class: 'sourceglance-widget-body'});
        if ('orientation' in this._body)
            this._body.orientation = Clutter.Orientation.VERTICAL;
        else
            this._body.vertical = true;
        this.actor.add_child(this._body);
        this._footer = new St.Label({style_class: 'sourceglance-widget-footer'});
        this.actor.add_child(this._footer);

        this._header.connect('button-press-event', (_actor, event) => this._startDrag(event));
    }

    destroy() {
        this._endDrag(false);
        this.actor.destroy();
    }

    // Dragging by the header: follow the pointer until release, then save the spot.
    _startDrag(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        this._drag = {dx: x - this.actor.x, dy: y - this.actor.y};
        this._dragId = global.stage.connect('captured-event', (_stage, e) => {
            const type = e.type();
            if (type === Clutter.EventType.MOTION) {
                const [mx, my] = e.get_coords();
                this.actor.set_position(Math.round(mx - this._drag.dx), Math.round(my - this._drag.dy));
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.BUTTON_RELEASE) {
                this._endDrag(true);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        return Clutter.EVENT_STOP;
    }

    _endDrag(save) {
        if (this._dragId)
            global.stage.disconnect(this._dragId);
        this._dragId = 0;
        if (save && this._drag)
            this._onDragEnd(this);
        this._drag = null;
    }

    _row({gicon = null, iconName = null, text, detail = '', onClick}) {
        const box = new St.BoxLayout({style_class: 'sourceglance-widget-row-box', x_expand: true});
        // Only one of the two: an empty icon_name would clear a themed gicon.
        box.add_child(new St.Icon({...gicon ? {gicon} : {icon_name: iconName}, style_class: 'sourceglance-widget-icon'}));
        box.add_child(new St.Label({text, x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        if (detail)
            box.add_child(new St.Label({text: detail, style_class: 'sourceglance-widget-detail', y_align: Clutter.ActorAlign.CENTER}));
        const row = new St.Button({child: box, style_class: 'sourceglance-widget-row', x_expand: true, can_focus: true});
        if (onClick)
            row.connect('clicked', onClick);
        else
            row.reactive = false;
        this._body.add_child(row);
    }

    _message(text) {
        this._body.add_child(new St.Label({text, style_class: 'sourceglance-widget-message'}));
    }

    render(state, icons, repos) {
        this._body.destroy_all_children();
        this._footer.text = updatedText(state);
        const signedIn = state.status === 'ready' || state.status === 'error' || state.gitlab?.status === 'ready';
        this._count.text = this.id === 'summary' ? '' : listBadge(this.id, state);
        if (!signedIn) {
            this._message(state.status === 'signed-out'
                ? _('Sign in from the Source Glance menu.')
                : _('Loading…'));
            return;
        }
        switch (this.id) {
        case 'summary':
            this._renderSummary(state, icons, repos);
            break;
        case 'issues':
        case 'prs':
            this._renderItems(state, icons, repos);
            break;
        case 'projects':
            this._renderProjects(state, icons);
            break;
        }
    }

    _renderSummary(state, icons, repos) {
        const github = page => () => openUri(page);
        this._row({gicon: icons.issues, text: _('Issues'), detail: listBadge('issues', state),
            onClick: github(searchPageUrl('issue', repos))});
        this._row({gicon: icons.prs, text: _('Pull requests'), detail: listBadge('prs', state),
            onClick: github('https://github.com/pulls')});
        this._row({gicon: icons.projects, text: _('Project drafts'), detail: listBadge('projects', state) || '–'});
        // GitHub's and (when signed in) GitLab's closed counts, added up.
        const sum = key => {
            const counts = [state.closedCounts?.[key]];
            if (state.gitlab?.status === 'ready')
                counts.push(state.gitlab.closedCounts?.[key]);
            const known = counts.filter(n => Number.isInteger(n));
            return known.length ? String(known.reduce((a, b) => a + b, 0)) : '–';
        };
        this._row({gicon: icons.issueClosed, text: _('Closed issues still assigned'), detail: sum('issues'),
            onClick: github(searchPageUrl('issue-closed', repos))});
        this._row({gicon: icons.prMerged, text: _('Merged or closed PRs still assigned'), detail: sum('prs'),
            onClick: github(searchPageUrl('pr-closed', repos))});
    }

    _renderItems(state, icons, repos) {
        const pr = this.id === 'prs';
        const gl = state.gitlab?.status === 'ready' ? state.gitlab : null;
        const items = [
            ...(pr ? state.prGroups : state.groups).flatMap(group => group.issues),
            ...(gl ? (pr ? gl.prGroups : gl.groups).flatMap(group => group.issues) : []),
        ];
        if (items.length === 0) {
            this._message(pr ? _('No open pull requests for you') : _('No open issues assigned to you'));
            return;
        }
        for (const item of items.slice(0, MAX_ROWS)) {
            this._row({gicon: pr ? icons.prs : icons.issue, text: `${itemRef(item)}  ${truncate(item.title, 34)}`,
                detail: [item.platform === 'gitlab' ? 'GitLab' : '', pr && item.reason === 'review' ? _('review') : '']
                    .filter(Boolean).join(' · '),
                onClick: item.url ? () => openUri(item.url) : null});
        }
        if (items.length > MAX_ROWS) {
            this._row({iconName: 'view-more-horizontal-symbolic',
                text: ngettext('%d more on GitHub', '%d more on GitHub', items.length - MAX_ROWS).format(items.length - MAX_ROWS),
                onClick: () => openUri(searchPageUrl(pr ? 'pr-assigned' : 'issue', repos))});
        }
    }

    _renderProjects(state, icons) {
        if (state.boardsError) {
            this._message(_('Can’t read your project boards.'));
            return;
        }
        if (state.boards === null) {
            this._message(_('Loading project boards…'));
            return;
        }
        const drafts = state.boards.flatMap(board => board.drafts.map(draft => ({board, draft})));
        if (drafts.length === 0) {
            this._message(_('No draft items on your project boards'));
            return;
        }
        for (const {board, draft} of drafts.slice(0, MAX_ROWS)) {
            this._row({
                gicon: isDoneStatus(draft.status) ? icons.issueClosed : null,
                iconName: isDoneStatus(draft.status) ? null : 'document-edit-symbolic',
                text: truncate(draft.title || _('Untitled draft'), 30),
                detail: draft.status ?? _('No status'),
                onClick: board.url ? () => openUri(board.url) : null,
            });
        }
    }
}

export class DesktopWidgets {
    /** `icons` are the extension's Gio.Icons; `getRepos()` returns the watched repositories. */
    constructor({settings, icons, getRepos}) {
        this._settings = settings;
        this._icons = icons;
        this._getRepos = getRepos;
        this._cards = new Map();
        this._state = null;
        this._restackedId = global.display.connect('restacked', () => this._restack());
        this._workareasId = global.display.connect('workareas-changed', () => this._placeAll());
        this._settingsId = settings.connect('changed', (_settings, key) => {
            if (key === 'widgets')
                this._sync();
            else if (key === 'widget-opacity')
                this._applyOpacity();
            else if (key === 'widget-positions')
                this._placeAll();
        });
        this._sync();
    }

    destroy() {
        global.display.disconnect(this._restackedId);
        global.display.disconnect(this._workareasId);
        this._settings.disconnect(this._settingsId);
        for (const card of this._cards.values())
            card.destroy();
        this._cards.clear();
    }

    update(state) {
        this._state = state;
        for (const card of this._cards.values())
            card.render(state, this._icons, this._getRepos());
        this._placeAll();
    }

    /** Creates and removes cards to match the `widgets` setting. */
    _sync() {
        const wanted = normalizeWidgets(this._settings.get_strv('widgets'));
        for (const [id, card] of this._cards) {
            if (!wanted.includes(id)) {
                card.destroy();
                this._cards.delete(id);
            }
        }
        const titles = {summary: _('Source Glance'), issues: _('Issues'), prs: _('Pull requests'), projects: _('Projects')};
        const icons = {summary: this._icons.app, issues: this._icons.issues, prs: this._icons.prs, projects: this._icons.projects};
        for (const id of wanted) {
            if (this._cards.has(id))
                continue;
            const card = new Card({id, title: titles[id], gicon: icons[id], onDragEnd: c => this._savePosition(c)});
            global.window_group.add_child(card.actor);
            this._cards.set(id, card);
            if (this._state)
                card.render(this._state, this._icons, this._getRepos());
        }
        // Keep display order (Map insertion order) stable for default placement.
        this._cards = new Map(wanted.map(id => [id, this._cards.get(id)]));
        this._applyOpacity();
        this._placeAll();
        this._restack();
    }

    _applyOpacity() {
        const opacity = Math.round(255 * this._settings.get_int('widget-opacity') / 100);
        for (const card of this._cards.values())
            card.actor.opacity = opacity;
    }

    _savedPositions() {
        return this._settings.get_value('widget-positions').deep_unpack();
    }

    /** Saved spots (kept on screen), or a column at the right edge for cards never moved. */
    _placeAll() {
        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        const saved = this._savedPositions();
        const heights = [];
        for (const card of this._cards.values()) {
            const [, height] = card.actor.get_preferred_height(WIDGET_WIDTH);
            const spot = saved[card.id]
                ? {x: saved[card.id][0], y: saved[card.id][1]}
                : defaultWidgetPosition(area, heights);
            const {x, y} = clampWidgetPosition(spot, area, {width: WIDGET_WIDTH, height});
            card.actor.set_position(x, y);
            if (!saved[card.id])
                heights.push(height);
        }
    }

    _savePosition(card) {
        const positions = this._savedPositions();
        positions[card.id] = [Math.round(card.actor.x), Math.round(card.actor.y)];
        this._settings.set_value('widget-positions', new GLib.Variant('a{s(ii)}', positions));
    }

    /** Just above the desktop window if there is one, else right above the wallpaper. */
    _restack() {
        // Desktop Icons hides its windows from global.get_window_actors(), so look at the
        // window layer itself.
        const desktop = global.window_group.get_children()
            .find(actor => actor instanceof Meta.WindowActor && isDesktopWindow(actor.meta_window));
        let below = desktop ?? Main.layoutManager._backgroundGroup;
        for (const card of this._cards.values()) {
            if (below?.get_parent() === global.window_group) {
                global.window_group.set_child_above_sibling(card.actor, below);
                below = card.actor;
            } else {
                global.window_group.set_child_at_index(card.actor, 0);
            }
        }
    }
}
