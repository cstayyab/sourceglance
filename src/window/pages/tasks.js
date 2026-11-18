// Lists → Tasks: everything assigned to you in one list, from every account: issues, pull or
// merge requests and project drafts, newest first. No sections: an icon tells the kinds apart.
// Filters: Kind, Accounts, Labels and Assignee are check lists; what's checked shows as chips
// on the row below, each with × to remove it, and Clear filters removes them all. Rows are the
// lists' own (common.js). Text from GitHub and GitLab is shown as plain text.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {TASK_FILTER_TYPES, allTasks, filterTasks, itemKey, taskFilterGroups, toggleTaskFilter} from '../../lib/model.js';
import {draftRow, issueRow, noMatchesGroup, statusText} from './common.js';

export class TasksPage {
    /** `icons` has issue, pr, issueClosed (Gio.Icon); `onClearSearch` empties the window's search box. */
    constructor({icons, actions, onClearSearch}) {
        this._icons = icons;
        this._actions = actions;
        this._onClearSearch = onClearSearch;
        this._state = null;
        // Active filters, in the order added: [{type: 'kind'|'account'|'label'|'assignee', value, title}].
        this._filters = [];
        this._query = '';
        this._terms = [];
        this._groups = [];

        this._statusPage = new Adw.StatusPage();
        this._page = new Adw.PreferencesPage({vexpand: true});

        // The filter bar stays put above the list while it scrolls: a button per kind of
        // filter, then the chosen ones as chips on a row of their own.
        const buttons = new Gtk.Box({spacing: 6});
        this._menus = {};
        for (const type of TASK_FILTER_TYPES) {
            const count = new Gtk.Label({css_classes: ['sourceglance-filter-count'], valign: Gtk.Align.CENTER, visible: false});
            const content = new Gtk.Box({spacing: 6});
            content.append(new Gtk.Label({label: this._typeTitle(type)}));
            content.append(count);
            const menu = new Gtk.MenuButton({child: content, always_show_arrow: true, css_classes: ['flat'],
                tooltip_text: this._typeTooltip(type), popover: new Gtk.Popover()});
            this._menus[type] = {menu, count};
            buttons.append(menu);
        }
        this._chipBox = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, column_spacing: 6, row_spacing: 6,
            max_children_per_line: 30, hexpand: true});
        this._clear = new Gtk.Button({label: _('Clear filters'), css_classes: ['flat'], valign: Gtk.Align.START});
        this._clear.connect('clicked', () => this._setFilters([]));
        this._chipRow = new Gtk.Box({spacing: 6, visible: false});
        this._chipRow.append(this._chipBox);
        this._chipRow.append(this._clear);
        const bar = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_top: 12, margin_bottom: 6,
            margin_start: 12, margin_end: 12, css_classes: ['sourceglance-filter-bar']});
        bar.append(buttons);
        bar.append(this._chipRow);

        const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        list.append(new Adw.Clamp({child: bar, maximum_size: 800}));
        list.append(this._page);

        this.widget = new Gtk.Stack({transition_type: Gtk.StackTransitionType.CROSSFADE});
        this.widget.add_named(this._statusPage, 'status');
        this.widget.add_named(list, 'list');
    }

    /** Shows only the tasks matching `terms`; [] shows them all again. */
    setSearch(query, terms) {
        this._query = query;
        this._terms = terms;
        if (this._state)
            this.update(this._state);
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

        const tasks = allTasks(state.sources);
        // An account that's gone takes its filter with it.
        const keys = (state.sources ?? []).map(source => source.key);
        this._filters = this._filters.filter(filter => filter.type !== 'account' || keys.includes(filter.value));
        this._renderFilterBar(tasks, state.sources);

        const shown = filterTasks(tasks, this._filters, this._terms);
        const group = new Adw.PreferencesGroup();
        if (shown.length === 0 && this._terms.length) {
            this._add(noMatchesGroup(this._query, () => this._onClearSearch()));
            return;
        }
        if (shown.length === 0) {
            group.add(new Adw.ActionRow({title: tasks.length ? _('Nothing matches these filters') : _('Nothing assigned to you'),
                use_markup: false, css_classes: ['dim-label']}));
        }
        for (const task of shown)
            group.add(this._taskRow(task, state.busy ?? []));
        this._add(group);
    }

    _setFilters(filters) {
        this._filters = filters;
        if (this._state)
            this.update(this._state);
    }

    _kindTitle(kind) {
        return {issue: _('Issues'), pr: _('Pull requests'), draft: _('Projects')}[kind];
    }

    _typeTitle(type) {
        return {kind: _('Kind'), account: _('Accounts'), label: _('Labels'), assignee: _('Assignee')}[type];
    }

    _typeTooltip(type) {
        return {
            kind: _('Show issues, pull requests or project drafts'),
            account: _('Show what one of your accounts has'),
            label: _('Show tasks with a label'),
            assignee: _('Show tasks assigned to someone'),
        }[type];
    }

    /** The chip's kind of filter, before its name. */
    _chipType(type) {
        return {kind: _('Kind'), account: _('Account'), label: _('Label'), assignee: _('Assignee')}[type];
    }

    /** Each filter button's check list (with counts), and the chosen filters as chips. */
    _renderFilterBar(tasks, sources) {
        for (let child = this._chipBox.get_first_child(); child;) {
            const next = child.get_next_sibling();
            this._chipBox.remove(child);
            child = next;
        }
        for (const filter of this._filters) {
            const title = filter.type === 'kind' ? this._kindTitle(filter.value) : filter.title;
            const chip = new Gtk.Box({spacing: 4, css_classes: ['sourceglance-chip'], valign: Gtk.Align.CENTER});
            chip.append(new Gtk.Label({label: this._chipType(filter.type), css_classes: ['dim-label']}));
            chip.append(new Gtk.Label({label: title, ellipsize: 3 /* END */, max_width_chars: 24}));
            const remove = new Gtk.Button({icon_name: 'window-close-symbolic', tooltip_text: _('Remove this filter'),
                css_classes: ['flat', 'sourceglance-chip-remove'], valign: Gtk.Align.CENTER});
            remove.update_property([Gtk.AccessibleProperty.LABEL], [_('Remove the filter %s').format(title)]);
            remove.connect('clicked', () => this._setFilters(this._filters.filter(other => other !== filter)));
            chip.append(remove);
            this._chipBox.append(chip);
        }
        this._chipRow.visible = this._filters.length > 0;

        const groups = taskFilterGroups(tasks, sources, this._filters);
        for (const type of TASK_FILTER_TYPES) {
            const {menu, count} = this._menus[type];
            const options = groups[type];
            const checked = options.filter(option => option.active).length;
            count.label = String(checked);
            count.visible = checked > 0;
            menu.sensitive = options.length > 0;
            const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2,
                margin_top: 4, margin_bottom: 4, margin_start: 4, margin_end: 4});
            for (const option of options) {
                const title = type === 'kind' ? this._kindTitle(option.value) : option.title;
                const line = new Gtk.Box({spacing: 12});
                line.append(new Gtk.Label({label: title, xalign: 0, hexpand: true, ellipsize: 3 /* END */, max_width_chars: 32}));
                line.append(new Gtk.Label({label: String(option.count), css_classes: ['dim-label', 'numeric']}));
                const check = new Gtk.CheckButton({child: line, active: option.active});
                check.connect('toggled', () => {
                    // Rebuild after the signal; the popover stays open for more checks.
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        this._setFilters(toggleTaskFilter(this._filters, {type, value: option.value, title}));
                        return GLib.SOURCE_REMOVE;
                    });
                });
                list.append(check);
            }
            menu.popover.child = options.length > 8
                ? new Gtk.ScrolledWindow({child: list, hscrollbar_policy: Gtk.PolicyType.NEVER,
                    propagate_natural_height: true, max_content_height: 360})
                : list;
        }
    }

    _add(group) {
        this._page.add(group);
        this._groups.push(group);
    }

    _taskRow(task, busyKeys) {
        if (task.kind === 'draft') {
            return draftRow({board: task.board, draft: task.draft, busyKeys, icons: this._icons, actions: this._actions,
                context: task.repo});
        }
        return issueRow({item: task.item, busy: busyKeys.includes(itemKey(task.item)), icons: this._icons,
            actions: this._actions, context: task.repo});
    }
}
