// Lists → Issues / Pull requests: items grouped by repository, a label filter, actions per
// item, and the closed-but-assigned count. Text from GitHub is always shown as plain text.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _, ngettext} from '../i18n.js';

import {gitlabClosedPageUrl} from '../../lib/gitlabModel.js';
import {filterByLabel, itemKey, itemRef, labelOptions, listBadge, searchGroups, searchPageUrl} from '../../lib/model.js';
import {actionButton, noMatchesGroup, statusText} from './common.js';

// Built on use: gettext only works once the window has set up translations, not at import.
function copyFor(key) {
    return {
        issues: {
            title: _('Issues'),
            empty: _('No open issues assigned to you'),
            emptyGitLab: _('No open GitLab issues assigned to you'),
            closedGitLab: n => ngettext('%d closed GitLab issue still assigned to you',
                '%d closed GitLab issues still assigned to you', n).format(n),
            closedSearch: 'issue-closed',
            closedIcon: 'issueClosed',
            closed: n => ngettext('%d closed issue still assigned to you', '%d closed issues still assigned to you', n).format(n),
        },
        prs: {
            title: _('Pull requests'),
            empty: _('No open pull requests for you'),
            emptyGitLab: _('No open merge requests for you'),
            closedGitLab: n => ngettext('%d merged or closed merge request still assigned to you',
                '%d merged or closed merge requests still assigned to you', n).format(n),
            closedSearch: 'pr-closed',
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
        // Label chosen per platform; null shows everything.
        this._filters = {github: null, gitlab: null};
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
        const gl = state.gitlab;
        const sections = gl && gl.status !== 'signed-out';
        // Without GitLab, the page is GitHub's alone: its status replaces the list.
        const status = sections ? null : statusText(state);
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
        const github = {
            platform: 'github', status: state.status, updatedAt: state.updatedAt,
            groups: this._key === 'issues' ? state.groups : state.prGroups,
            closedCount: state.closedCounts[this._key],
            closedUrl: searchPageUrl(copy.closedSearch, this._repos()),
        };
        if (!sections) {
            this._renderPlatform(github, copy, state, add);
            return;
        }
        const gitlab = {
            platform: 'gitlab', status: gl.status, updatedAt: gl.updatedAt,
            groups: (this._key === 'issues' ? gl.groups : gl.prGroups) ?? [],
            closedCount: gl.closedCounts?.[this._key],
            closedUrl: gitlabClosedPageUrl(this._key === 'issues' ? 'issue' : 'pr', gl.login),
        };
        for (const src of [github, gitlab]) {
            // Same ids as the top-bar menus, so a section collapses in both places.
            const id = `${this._key}:${src.platform}`;
            const collapsed = this._settings.get_strv('collapsed-sections').includes(id);
            const header = new Adw.PreferencesGroup({title: src.platform === 'gitlab' ? 'GitLab' : 'GitHub'});
            const suffix = new Gtk.Box({spacing: 8});
            // While searching, the section counts its matches instead of its total.
            const count = this._terms.length
                ? String(searchGroups(src.groups ?? [], this._terms).reduce((sum, group) => sum + group.issues.length, 0))
                : listBadge(this._key, src.platform === 'gitlab' ? {status: 'signed-out', gitlab: gl} : {...state, gitlab: null});
            if (count)
                suffix.append(new Gtk.Label({label: count, css_classes: ['sourceglance-count-pill'], valign: Gtk.Align.CENTER}));
            const toggle = new Gtk.Button({icon_name: collapsed ? 'pan-end-symbolic' : 'pan-down-symbolic',
                tooltip_text: collapsed ? _('Show') : _('Hide'), css_classes: ['flat'], valign: Gtk.Align.CENTER});
            toggle.connect('clicked', () => {
                const current = this._settings.get_strv('collapsed-sections');
                this._settings.set_strv('collapsed-sections',
                    current.includes(id) ? current.filter(other => other !== id) : [...current, id]);
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this.update(this._state);
                    return GLib.SOURCE_REMOVE;
                });
            });
            suffix.append(toggle);
            header.set_header_suffix(suffix);
            add(header);
            if (!collapsed)
                this._renderPlatform(src, copy, state, add);
        }
    }

    /** One platform: its status, label filter, items by repository, and closed footer. */
    _renderPlatform(src, copy, state, add) {
        const gitlab = src.platform === 'gitlab';
        if (src.status === 'signed-out' || !src.updatedAt) {
            const note = new Adw.PreferencesGroup();
            note.add(new Adw.ActionRow({
                title: src.status === 'signed-out'
                    ? _('Not signed in. Sign in under Settings → Accounts.')
                    : src.status === 'error' ? _('Couldn’t load. Retrying soon.') : _('Loading…'),
                use_markup: false, css_classes: ['dim-label'],
            }));
            add(note);
            return;
        }
        const options = labelOptions(src.groups);
        if (this._filters[src.platform] !== null && !options.some(option => option.name === this._filters[src.platform]))
            this._filters[src.platform] = null;
        const filter = this._filters[src.platform];

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
            this._filters[src.platform] = names[combo.selected] ?? null;
            // Rebuild after this signal: the combo itself is replaced.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this.update(this._state);
                return GLib.SOURCE_REMOVE;
            });
        });
        filterGroup.add(combo);
        add(filterGroup);

        const shown = filterByLabel(searchGroups(src.groups, this._terms), filter);
        if (shown.length === 0 && this._terms.length) {
            add(noMatchesGroup(this._query, () => this._onClearSearch()));
        } else if (shown.length === 0) {
            const empty = new Adw.PreferencesGroup();
            empty.add(new Adw.ActionRow({title: gitlab ? copy.emptyGitLab : copy.empty, use_markup: false, css_classes: ['dim-label']}));
            add(empty);
        }
        for (const group of shown) {
            const repoGroup = new Adw.PreferencesGroup({title: GLib.markup_escape_text(group.repo, -1)});
            for (const item of group.issues)
                repoGroup.add(this._itemRow(item, state.busy.includes(itemKey(item))));
            add(repoGroup);
        }

        if (src.closedCount !== null && src.closedCount !== undefined) {
            const footer = new Adw.PreferencesGroup();
            const row = new Adw.ActionRow({title: (gitlab ? copy.closedGitLab : copy.closed)(src.closedCount),
                activatable: true, use_markup: false});
            row.add_prefix(new Gtk.Image({gicon: this._icons[copy.closedIcon]}));
            row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
            row.connect('activated', () => this._actions.open(src.closedUrl));
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
            label: item.platform === 'gitlab' ? _('Open on GitLab') : _('Open on GitHub'), onClick: () => a.open(item.url)}));
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
