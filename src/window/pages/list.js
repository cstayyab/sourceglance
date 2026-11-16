// Lists → Issues / Pull requests: items grouped by repository, a label filter, actions per
// item, and the closed-but-assigned count. Text from GitHub is always shown as plain text.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _, ngettext} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {filterByLabel, itemKey, labelOptions, searchPageUrl} from '../../lib/model.js';
import {actionButton, statusText} from './common.js';

// Built on use: gettext only works once GNOME has registered the extension, not at import.
function copyFor(key) {
    return {
        issues: {
            title: _('Issues'),
            empty: _('No open issues assigned to you'),
            closedSearch: 'issue-closed',
            closedIcon: 'issueClosed',
            closed: n => ngettext('%d closed issue still assigned to you', '%d closed issues still assigned to you', n).format(n),
        },
        prs: {
            title: _('Pull requests'),
            empty: _('No open pull requests for you'),
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
    /** `key` is 'issues' or 'prs'; `icons` has issue, pr, label, projects (Gio.Icon). */
    constructor({key, icons, actions, repos}) {
        this._key = key;
        this._icons = icons;
        this._actions = actions;
        this._repos = repos;
        this._filter = null;
        this._state = null;
        this._groups = [];

        this._statusPage = new Adw.StatusPage();
        this._page = new Adw.PreferencesPage();
        this.widget = new Gtk.Stack({transition_type: Gtk.StackTransitionType.CROSSFADE});
        this.widget.add_named(this._statusPage, 'status');
        this.widget.add_named(this._page, 'list');
    }

    update(state) {
        this._state = state;
        const status = statusText(state);
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
        const groups = this._key === 'issues' ? state.groups : state.prGroups;
        const options = labelOptions(groups);
        if (this._filter !== null && !options.some(option => option.name === this._filter))
            this._filter = null;

        // Label filter
        const filterGroup = new Adw.PreferencesGroup();
        const names = [null, ...options.map(option => option.name)];
        const combo = new Adw.ComboRow({
            title: _('Label'),
            model: Gtk.StringList.new([_('All labels'), ...options.map(option => `${option.name} (${option.count})`)]),
            selected: Math.max(0, names.indexOf(this._filter)),
            sensitive: options.length > 0,
            subtitle: options.length ? '' : _('No labels on these items yet'),
        });
        combo.add_prefix(new Gtk.Image({gicon: this._icons.label}));
        combo.connect('notify::selected', () => {
            this._filter = names[combo.selected] ?? null;
            // Rebuild after this signal: the combo itself is replaced.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this.update(this._state);
                return GLib.SOURCE_REMOVE;
            });
        });
        filterGroup.add(combo);
        add(filterGroup);

        const shown = filterByLabel(groups, this._filter);
        if (shown.length === 0) {
            const empty = new Adw.PreferencesGroup();
            empty.add(new Adw.ActionRow({title: copy.empty, use_markup: false, css_classes: ['dim-label']}));
            add(empty);
        }
        for (const group of shown) {
            const repoGroup = new Adw.PreferencesGroup({title: GLib.markup_escape_text(group.repo, -1)});
            for (const item of group.issues)
                repoGroup.add(this._itemRow(item, state.busy.includes(itemKey(item))));
            add(repoGroup);
        }

        // Footer: closed but still assigned
        const count = state.closedCounts[this._key];
        if (count !== null && count !== undefined) {
            const footer = new Adw.PreferencesGroup();
            const row = new Adw.ActionRow({title: copy.closed(count), activatable: true, use_markup: false});
            row.add_prefix(new Gtk.Image({gicon: this._icons[copy.closedIcon]}));
            row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
            row.connect('activated', () => this._actions.open(searchPageUrl(copy.closedSearch, this._repos())));
            footer.add(row);
            add(footer);
        }
    }

    _itemRow(item, busy) {
        const row = new Adw.ExpanderRow({
            title: `#${item.number}  ${item.title}`,
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
        buttons.append(actionButton({iconName: 'web-browser-symbolic', label: _('Open on GitHub'), onClick: () => a.open(item.url)}));
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
