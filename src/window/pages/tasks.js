// Lists → All Tasks: everything assigned to you in one list, from every account: issues, pull
// or merge requests and project drafts, newest first. No sections: an icon tells the kinds
// apart. Filters by Kind, Accounts, Labels and Assignee (filterBar.js). Rows are the lists'
// own (common.js). Text from GitHub and GitLab is shown as plain text.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {TASK_FILTER_TYPES, allTasks, filterTasks, itemKey} from '../../lib/model.js';
import {draftRow, issueRow, noMatchesGroup, statusText} from './common.js';
import {FilterBar} from './filterBar.js';

export class TasksPage {
    /** `icons` has issue, pr, issueClosed (Gio.Icon); `onClearSearch` empties the window's search box. */
    constructor({icons, actions, onClearSearch}) {
        this._icons = icons;
        this._actions = actions;
        this._onClearSearch = onClearSearch;
        this._state = null;
        this._query = '';
        this._terms = [];
        this._groups = [];

        this._statusPage = new Adw.StatusPage();
        this._page = new Adw.PreferencesPage({vexpand: true});

        // The filter bar stays put above the list while it scrolls.
        this._bar = new FilterBar({types: TASK_FILTER_TYPES, onChange: () => this._state && this.update(this._state)});

        const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        list.append(this._bar.widget);
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
        this._bar.update(tasks, state.sources);
        const shown = filterTasks(tasks, this._bar.filters, this._terms);
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
