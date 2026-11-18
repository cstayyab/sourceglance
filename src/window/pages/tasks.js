// Lists → Tasks: everything assigned to you in one list, from every account: issues, pull or
// merge requests and project drafts, newest first. No sections: an icon tells the kinds apart.
// Filters work like tags: + adds one (a kind, or an assignee: one of your accounts), each
// shows as a chip with × to remove it, and Clear filters removes them all. Clicking a task
// opens it in the browser (a draft, which has no page of its own, opens its board). Text from
// GitHub and GitLab is shown as plain text.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {allTasks, filterTasks, isDoneStatus, taskFilterOptions} from '../../lib/model.js';
import {noMatchesGroup, statusText} from './common.js';

export class TasksPage {
    /** `icons` has issue, pr, issueClosed (Gio.Icon); `onClearSearch` empties the window's search box. */
    constructor({icons, actions, onClearSearch}) {
        this._icons = icons;
        this._actions = actions;
        this._onClearSearch = onClearSearch;
        this._state = null;
        // Active filters, in the order added: [{type: 'kind'|'account', value, title}].
        this._filters = [];
        this._query = '';
        this._terms = [];
        this._groups = [];

        this._statusPage = new Adw.StatusPage();
        this._page = new Adw.PreferencesPage({vexpand: true});

        // The filter bar stays put above the list while it scrolls.
        this._chipBox = new Gtk.Box({spacing: 6});
        this._addMenu = new Gtk.MenuButton({
            child: new Adw.ButtonContent({icon_name: 'list-add-symbolic', label: _('Filter')}),
            tooltip_text: _('Add a filter'),
            css_classes: ['flat'],
            popover: new Gtk.Popover(),
        });
        this._clear = new Gtk.Button({label: _('Clear filters'), css_classes: ['flat'], visible: false});
        this._clear.connect('clicked', () => this._setFilters([]));
        const bar = new Gtk.Box({spacing: 6, margin_top: 12, margin_bottom: 6, margin_start: 12, margin_end: 12,
            css_classes: ['sourceglance-filter-bar']});
        bar.append(this._chipBox);
        bar.append(this._addMenu);
        bar.append(new Gtk.Box({hexpand: true}));
        bar.append(this._clear);

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
            group.add(this._taskRow(task));
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

    /** The active filters as chips with ×, the + menu with the rest (and their counts), and Clear. */
    _renderFilterBar(tasks, sources) {
        for (let child = this._chipBox.get_first_child(); child;) {
            const next = child.get_next_sibling();
            this._chipBox.remove(child);
            child = next;
        }
        for (const filter of this._filters) {
            const title = filter.type === 'kind' ? this._kindTitle(filter.value) : filter.title;
            const chip = new Gtk.Box({spacing: 2, css_classes: ['sourceglance-chip'], valign: Gtk.Align.CENTER});
            chip.append(new Gtk.Image({icon_name: filter.type === 'kind' ? 'view-list-bullet-symbolic' : 'avatar-default-symbolic',
                pixel_size: 12, margin_start: 4}));
            chip.append(new Gtk.Label({label: title, ellipsize: 3 /* END */, max_width_chars: 24, margin_start: 2}));
            const remove = new Gtk.Button({icon_name: 'window-close-symbolic', tooltip_text: _('Remove this filter'),
                css_classes: ['flat', 'circular', 'sourceglance-chip-remove'], valign: Gtk.Align.CENTER});
            remove.update_property([Gtk.AccessibleProperty.LABEL], [_('Remove the filter %s').format(title)]);
            remove.connect('clicked', () => this._setFilters(this._filters.filter(other => other !== filter)));
            chip.append(remove);
            this._chipBox.append(chip);
        }
        this._clear.visible = this._filters.length > 0;

        // The + menu: what can still be added, with how many tasks each has.
        const options = taskFilterOptions(tasks, sources, this._filters);
        this._addMenu.sensitive = options.length > 0;
        const menu = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['navigation-sidebar']});
        let lastType = null;
        for (const option of options) {
            if (option.type !== lastType) {
                lastType = option.type;
                const heading = new Gtk.ListBoxRow({activatable: false, selectable: false,
                    child: new Gtk.Label({label: option.type === 'kind' ? _('Kind') : _('Assignee'), xalign: 0,
                        css_classes: ['dim-label', 'caption-heading'], margin_top: 6, margin_start: 6})});
                menu.append(heading);
            }
            const title = option.type === 'kind' ? this._kindTitle(option.value) : option.title;
            const box = new Gtk.Box({spacing: 12});
            box.append(new Gtk.Label({label: title, xalign: 0, hexpand: true, ellipsize: 3 /* END */, max_width_chars: 32}));
            box.append(new Gtk.Label({label: String(option.count), css_classes: ['dim-label', 'numeric']}));
            const row = new Gtk.ListBoxRow({child: box});
            row._option = {type: option.type, value: option.value, title};
            menu.append(row);
        }
        menu.connect('row-activated', (_menu, row) => {
            if (!row._option)
                return;
            this._addMenu.popover.popdown();
            this._setFilters([...this._filters, row._option]);
        });
        this._addMenu.popover.child = menu;
    }

    _add(group) {
        this._page.add(group);
        this._groups.push(group);
    }

    _taskRow(task) {
        const draft = task.kind === 'draft';
        const row = new Adw.ActionRow({
            title: draft ? task.title || _('Untitled draft') : `${task.ref}  ${task.title}`,
            subtitle: draft ? `${task.repo}  ·  ${task.status ?? _('No status')}` : task.repo,
            use_markup: false,
            activatable: Boolean(task.url),
            tooltip_text: task.url ? draft ? _('Open the board in your browser') : _('Open in your browser') : '',
        });
        const kindName = {issue: _('Issue'), pr: _('Pull request'), draft: _('Project draft')}[task.kind];
        const icon = draft
            ? isDoneStatus(task.status)
                ? new Gtk.Image({gicon: this._icons.issueClosed})
                : new Gtk.Image({icon_name: 'document-edit-symbolic'})
            : new Gtk.Image({gicon: task.kind === 'pr' ? this._icons.pr : this._icons.issue});
        icon.tooltip_text = kindName;
        icon.update_property([Gtk.AccessibleProperty.LABEL], [kindName]);
        row.add_prefix(icon);
        if (task.url) {
            row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
            row.connect('activated', () => this._actions.open(task.url));
        }
        return row;
    }
}
