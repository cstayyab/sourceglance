// A top-bar button: an icon with a count, and a menu filled by one of the views. A pure view:
// render(state) redraws everything (see views.js).
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {gtypeName} from './model.js';
import {TabBar} from './tabs.js';
import {VIEWS, addAppFooter, badgeText} from './views.js';

const NAMES = {
    issues: () => _('Issues'),
    projects: () => _('Projects'),
    prs: () => _('Pull requests'),
    app: () => 'sourceglance',
};

export const ToolbarButton = GObject.registerClass({GTypeName: gtypeName('ToolbarButton', import.meta.url)},
class ToolbarButton extends PanelMenu.Button {
    /**
     * @param {object} params
     * @param {string} params.id 'issues', 'prs', 'projects' or 'app'
     * @param {object} params.icons Gio.Icon per id
     * @param {string[]|null} params.tabs for the app button in the tabs layout: the lists to show as tabs
     */
    _init({id, icons, tabs = null, onRefresh, onSettings, onAbout, onAction, getRepos, getAutostart, setAutostart, onQuit,
        getCollapsed, setCollapsed}) {
        super._init(0.0, `sourceglance ${id}`);
        this._id = id;
        this._icons = icons;
        this._tabs = tabs;
        this._tab = tabs?.[0] ?? 'app';
        this._callbacks = {onRefresh, onSettings, onAbout, onAction, getRepos, getAutostart, setAutostart, onQuit};
        this._getCollapsed = getCollapsed;
        this._setCollapsed = setCollapsed;
        this._state = null;
        // Label chosen in each list's dropdown; null shows everything. Kept across refreshes.
        this._filters = {issues: null, prs: null};
        this._rebuildId = 0;
        this.connect('destroy', () => {
            if (this._rebuildId)
                GLib.source_remove(this._rebuildId);
            this._rebuildId = 0;
        });

        // All sourceglance buttons share a tinted group look (see stylesheet.css).
        this.add_style_class_name('sourceglance-group');
        if (id === 'app')
            this.add_style_class_name('sourceglance-group-app');

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({gicon: icons[id], style_class: 'system-status-icon'});
        this._count = new St.Label({
            style_class: 'sourceglance-count',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        box.add_child(this._icon);
        if (id === 'app') {
            box.add_child(new St.Label({
                text: 'sourceglance',
                style_class: 'sourceglance-app-label',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
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

    _badge() {
        if (this._id !== 'app')
            return badgeText(this._id, this._state);
        if (!this._tabs)
            return '';
        // Tabs layout: the one button counts every list.
        // Only numbers ('7', '25+'); skips '' and the '…' shown while projects load.
        const counts = this._tabs.map(id => badgeText(id, this._state)).filter(text => /^\d+\+?$/.test(text));
        if (counts.length === 0)
            return '';
        const total = counts.reduce((sum, text) => sum + Number.parseInt(text, 10), 0);
        return counts.some(text => text.endsWith('+')) ? `${total}+` : String(total);
    }

    _updatePanel() {
        const {status} = this._state;
        const label = this._badge();
        this._count.text = label;
        this._count.visible = label !== '';
        this._icon.opacity = status === 'error' || (status === 'signed-out' && this._id !== 'app') ? 128 : 255;

        const name = NAMES[this._id]();
        if (status === 'signed-out')
            this.accessible_name = _('%s: not signed in').format(name);
        else
            this.accessible_name = label ? `${name}: ${label}` : name;
    }

    // Rebuild after the current event: the item that was clicked is destroyed by the rebuild.
    _scheduleRebuild() {
        if (this._rebuildId)
            return;
        this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._rebuildId = 0;
            if (this._state)
                this._rebuildMenu();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Adds a section that scrolls inside the menu. The shell caps the menu at the screen
     * height; without a scrollable part, a long list squashes the open item's actions
     * submenu (the only part that can shrink) to a sliver.
     */
    _addScrollingSection() {
        const section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(section);
        const scroll = new St.ScrollView({
            style_class: 'sourceglance-scroll vfade',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        this.menu.box.replace_child(section.actor, scroll);
        scroll.child = section.actor;
        // The menu finds its items through _delegate; removeAll() destroys the section.
        scroll._delegate = section;
        section.connect('destroy', () => scroll.destroy());
        // Keep the item under keyboard focus in view.
        section.connect('active-changed', (_section, item) => {
            if (item)
                ensureActorVisibleInScrollView(scroll, item);
        });
        return section;
    }

    _rebuildMenu() {
        this.menu.removeAll();
        const ui = {
            menu: null,
            state: this._state,
            filters: this._filters,
            icons: this._icons,
            scheduleRebuild: () => this._scheduleRebuild(),
            repos: this._callbacks.getRepos(),
            collapsed: this._getCollapsed(),
            toggleCollapsed: id => {
                const current = this._getCollapsed();
                this._setCollapsed(current.includes(id) ? current.filter(other => other !== id) : [...current, id]);
                this._scheduleRebuild();
            },
            ...this._callbacks,
        };

        if (!this._tabs) {
            ui.menu = this._addScrollingSection();
            VIEWS[this._id](ui);
            ui.menu = this.menu;
            if (this._id === 'app')
                addAppFooter(ui);
            return;
        }
        const ids = [...this._tabs, 'app'];
        if (!ids.includes(this._tab))
            this._tab = ids[0];
        this.menu.addMenuItem(new TabBar({
            tabs: ids.map(id => ({id, gicon: this._icons[id], name: NAMES[id](), badge: badgeText(id, this._state)})),
            selected: this._tab,
            onSelect: id => {
                this._tab = id;
                this._scheduleRebuild();
            },
        }));
        ui.menu = this._addScrollingSection();
        VIEWS[this._tab](ui);
        ui.menu = this.menu;
        // In the tabs layout the footer stays at the bottom whichever tab is open.
        addAppFooter(ui);
    }
});
