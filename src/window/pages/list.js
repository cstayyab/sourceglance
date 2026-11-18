// Lists → Issues / Pull requests: one section per account, items grouped by repository, a
// label filter, actions per item, and the closed-but-assigned count. Text from GitHub and
// GitLab is always shown as plain text.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _, ngettext} from '../i18n.js';

import {
    filterByLabel,
    groupCollapseId,
    isGroupCollapsed,
    itemKey,
    itemRef,
    labelOptions,
    searchGroups,
    sourceBadge,
    toggleId,
} from '../../lib/model.js';
import {closedPageUrl} from '../../lib/requests.js';
import {actionButton, collapsibleGroup, noMatchesGroup, statusText} from './common.js';

// Built on use: gettext only works once the window has set up translations, not at import.
function copyFor(key) {
    return {
        issues: {
            title: _('Issues'),
            empty: _('No open issues assigned to you'),
            emptyGitLab: _('No open GitLab issues assigned to you'),
            closedGitLab: n => ngettext('%d closed GitLab issue still assigned to you',
                '%d closed GitLab issues still assigned to you', n).format(n),
            closedIcon: 'issueClosed',
            closed: n => ngettext('%d closed issue still assigned to you', '%d closed issues still assigned to you', n).format(n),
        },
        prs: {
            title: _('Pull requests'),
            empty: _('No open pull requests for you'),
            emptyGitLab: _('No open merge requests for you'),
            closedGitLab: n => ngettext('%d merged or closed merge request still assigned to you',
                '%d merged or closed merge requests still assigned to you', n).format(n),
            closedIcon: 'prMerged',
            closed: n => ngettext('%d merged or closed pull request still assigned to you',
                '%d merged or closed pull requests still assigned to you', n).format(n),
        },
    }[key];
}

function itemSubtitle(item) {
    const parts = [];
    if (item.kind === 'pr' && item.reason === 'review')
        parts.push(_('review requested'));
    if (item.labels.length)
        parts.push(item.labels.map(label => label.name).join(', '));
    if (item.assignees.length)
        parts.push(item.assignees.map(login => `@${login}`).join(' '));
    for (const board of item.boards ?? [])
        parts.push(`${board.title}: ${board.status ?? _('No status')}`);
    return parts.join('  ·  ');
}

export class ListPage {
    /**
     * `key` is 'issues' or 'prs'; `icons` has issue, pr, label, projects (Gio.Icon);
     * `onClearSearch` empties the window's search box.
     */
    constructor({key, icons, actions, repos, settings, onClearSearch}) {
        this._key = key;
        this._icons = icons;
        this._actions = actions;
        this._repos = repos;
        this._settings = settings;
        // Label chosen per account section; null shows everything.
        this._filters = {};
        this._state = null;
        this._groups = [];
        this._onClearSearch = onClearSearch;
        // The window's search: the box's text and its words (searchTerms); [] shows everything.
        this._query = '';
        this._terms = [];

        this._statusPage = new Adw.StatusPage();
        this._page = new Adw.PreferencesPage();
        this.widget = new Gtk.Stack({transition_type: Gtk.StackTransitionType.CROSSFADE});
        this.widget.add_named(this._statusPage, 'status');
        this.widget.add_named(this._page, 'list');
    }

    /** Shows only the items matching `terms`; [] shows the full list again. */
    setSearch(query, terms) {
        this._query = query;
        this._terms = terms;
        if (this._state)
            this.update(this._state);
    }

    update(state) {
        this._state = state;
        const sources = state.sources;
        // With one account, the page is its alone: its status replaces the list.
        const status = sources.length > 1 ? null : statusText(state);
        if (status) {
            this._statusPage.set({icon_name: status.icon, title: status.title, description: status.description});
            this.widget.visible_child_name = 'status';
            return;
        }
        this.widget.visible_child_name = 'list';
        for (const group of this._groups)
            this._page.remove(group);
        this._groups = [];
        const add = group => {
            this._page.add(group);
            this._groups.push(group);
        };

        const copy = copyFor(this._key);
        if (sources.length === 1) {
            this._renderSource(sources[0], copy, state, add);
            return;
        }
        for (const src of sources) {
            // Same ids as the top-bar menus, so a section collapses in both places.
            const id = `${this._key}:${src.key}`;
            const collapsed = this._settings.get_strv('collapsed-sections').includes(id);
            // Titles are platform, host and login only: no markup characters (accounts.js checks them).
            const header = new Adw.PreferencesGroup({title: src.title});
            const suffix = new Gtk.Box({spacing: 8});
            // While searching, the section counts its matches instead of its total.
            const groups = this._key === 'issues' ? src.groups : src.prGroups;
            const count = this._terms.length
                ? String(searchGroups(groups, this._terms).reduce((sum, group) => sum + group.issues.length, 0))
                : sourceBadge(this._key, src);
            if (count)
                suffix.append(new Gtk.Label({label: count, css_classes: ['sourceglance-count-pill'], valign: Gtk.Align.CENTER}));
            const toggle = new Gtk.Button({icon_name: collapsed ? 'pan-end-symbolic' : 'pan-down-symbolic',
                tooltip_text: collapsed ? _('Show') : _('Hide'), css_classes: ['flat'], valign: Gtk.Align.CENTER});
            toggle.connect('clicked', () => {
                this._settings.set_strv('collapsed-sections', toggleId(this._settings.get_strv('collapsed-sections'), id));
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this.update(this._state);
                    return GLib.SOURCE_REMOVE;
                });
            });
            suffix.append(toggle);
            header.set_header_suffix(suffix);
            add(header);
            if (!collapsed)
                this._renderSource(src, copy, state, add);
        }
    }

    /** One account: its status, label filter, items by repository, and closed footer. */
    _renderSource(src, copy, state, add) {
        const gitlab = src.platform === 'gitlab';
        const groups = this._key === 'issues' ? src.groups : src.prGroups;
        if (src.status === 'signed-out' || !src.updatedAt) {
            const note = new Adw.PreferencesGroup();
            note.add(new Adw.ActionRow({
                title: src.status === 'signed-out'
                    ? _('Not signed in. Sign in again under Settings → Accounts.')
                    : src.error?.kind === 'insecure'
                        ? _('This instance uses plain http:// and isn’t on your local network now.')
                        : src.status === 'error' ? _('Couldn’t load. Retrying soon.') : _('Loading…'),
                use_markup: false, css_classes: ['dim-label'],
            }));
            add(note);
            return;
        }
        const options = labelOptions(groups);
        const filter = options.some(option => option.name === this._filters[src.key]) ? this._filters[src.key] : null;
        this._filters[src.key] = filter;

        const filterGroup = new Adw.PreferencesGroup();
        const names = [null, ...options.map(option => option.name)];
        const combo = new Adw.ComboRow({
            title: _('Label'),
            model: Gtk.StringList.new([_('All labels'), ...options.map(option => `${option.name} (${option.count})`)]),
            selected: Math.max(0, names.indexOf(filter)),
            sensitive: options.length > 0,
            subtitle: options.length ? '' : _('No labels on these items yet'),
        });
        combo.add_prefix(new Gtk.Image({gicon: this._icons.label}));
        combo.connect('notify::selected', () => {
            this._filters[src.key] = names[combo.selected] ?? null;
            // Rebuild after this signal: the combo itself is replaced.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this.update(this._state);
                return GLib.SOURCE_REMOVE;
            });
        });
        filterGroup.add(combo);
        add(filterGroup);

        const shown = filterByLabel(searchGroups(groups, this._terms), filter);
        if (shown.length === 0 && this._terms.length) {
            add(noMatchesGroup(this._query, () => this._onClearSearch()));
        } else if (shown.length === 0) {
            const empty = new Adw.PreferencesGroup();
            empty.add(new Adw.ActionRow({title: gitlab ? copy.emptyGitLab : copy.empty, use_markup: false, css_classes: ['dim-label']}));
            add(empty);
        }
        const collapsedGroups = this._settings.get_strv('collapsed-groups');
        for (const group of shown) {
            // Same ids as the top-bar menus, so a repository collapses in both places.
            const id = groupCollapseId(this._key, src.key, group.repo);
            const collapsed = isGroupCollapsed(collapsedGroups, id, this._terms);
            const repoGroup = collapsibleGroup({
                title: group.repo, count: group.issues.length, collapsed, toggleable: this._terms.length === 0,
                onToggle: () => {
                    this._settings.set_strv('collapsed-groups', toggleId(this._settings.get_strv('collapsed-groups'), id));
                    this.update(this._state);
                },
            });
            if (!collapsed) {
                for (const item of group.issues)
                    repoGroup.add(this._itemRow(item, state.busy.includes(itemKey(item))));
            }
            add(repoGroup);
        }

        const closedCount = src.closedCounts?.[this._key];
        if (closedCount !== null && closedCount !== undefined) {
            const footer = new Adw.PreferencesGroup();
            const row = new Adw.ActionRow({title: (gitlab ? copy.closedGitLab : copy.closed)(closedCount),
                activatable: true, use_markup: false});
            row.add_prefix(new Gtk.Image({gicon: this._icons[copy.closedIcon]}));
            row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
            const url = closedPageUrl(src.account, this._key === 'issues' ? 'issue' : 'pr', this._repos());
            row.connect('activated', () => this._actions.open(url));
            footer.add(row);
            add(footer);
        }
    }

    _itemRow(item, busy) {
        const row = new Adw.ExpanderRow({
            title: `${itemRef(item)}  ${item.title}`,
            subtitle: busy ? _('Working…') : itemSubtitle(item),
            use_markup: false,
        });
        row.add_prefix(new Gtk.Image({gicon: item.kind === 'pr' ? this._icons.pr : this._icons.issue}));

        const buttons = new Gtk.FlowBox({
            selection_mode: Gtk.SelectionMode.NONE,
            max_children_per_line: 8,
            column_spacing: 6,
            row_spacing: 6,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 12,
            margin_end: 12,
            sensitive: !busy,
        });
        const a = this._actions;
        buttons.append(actionButton({iconName: 'web-browser-symbolic',
            label: a.openLabel(item), onClick: () => a.open(item.url)}));
        buttons.append(actionButton({iconName: 'chat-message-new-symbolic', label: _('Comment'), onClick: () => a.comment(item)}));
        buttons.append(item.kind === 'pr'
            ? actionButton({gicon: this._icons.prClosed, label: _('Close'), onClick: () => a.close(item)})
            : actionButton({gicon: this._icons.issueClosed, label: _('Close'), onClick: () => a.close(item)}));
        buttons.append(actionButton({iconName: 'system-users-symbolic', label: _('Assignees'), onClick: () => a.assignees(item)}));
        buttons.append(actionButton({gicon: this._icons.label, label: _('Labels'), onClick: () => a.labels(item)}));
        for (const board of item.boards ?? []) {
            buttons.append(actionButton({gicon: this._icons.projects, label: `${board.title}: ${board.status ?? _('No status')}`,
                onClick: () => a.status(item, board)}));
        }
        row.add_row(new Gtk.ListBoxRow({child: buttons, activatable: false, selectable: false}));
        return row;
    }
}
