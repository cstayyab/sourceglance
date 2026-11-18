// Lists → Tasks: everything assigned to you in one list, from every account: issues, pull or
// merge requests and project drafts, newest first. No sections: an icon tells the kinds apart,
// and chips at the top filter by kind. Clicking a task opens it in the browser (a draft, which
// has no page of its own, opens its board). Text from GitHub and GitLab is shown as plain text.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {allTasks, filterTasks, isDoneStatus, taskCounts} from '../../lib/model.js';
import {noMatchesGroup, statusText} from './common.js';

export class TasksPage {
    /** `icons` has issue, pr, issueClosed (Gio.Icon); `onClearSearch` empties the window's search box. */
    constructor({icons, actions, onClearSearch}) {
        this._icons = icons;
        this._actions = actions;
        this._onClearSearch = onClearSearch;
        this._state = null;
        // The chosen chip: a kind from TASK_KINDS, or null for all.
        this._kind = null;
        this._query = '';
        this._terms = [];
        this._groups = [];

        this._statusPage = new Adw.StatusPage();
        this._page = new Adw.PreferencesPage();

        // The chips stay put above the list while it scrolls.
        this._chips = new Map();
        const chipBox = new Gtk.Box({spacing: 6, margin_top: 12, margin_bottom: 6, margin_start: 12, margin_end: 12,
            css_classes: ['sourceglance-chips']});
        let first = null;
        for (const [kind, label] of [[null, _('All')], ['issue', _('Issues')], ['pr', _('Pull requests')], ['draft', _('Projects')]]) {
            const chip = new Gtk.ToggleButton({active: kind === null, css_classes: ['sourceglance-chip']});
            if (first)
                chip.group = first;
            else
                first = chip;
            chip._label = label;
            chip.connect('toggled', () => {
                if (!chip.active)
                    return;
                this._kind = kind;
                if (this._state)
                    this.update(this._state);
            });
            this._chips.set(kind, chip);
            chipBox.append(chip);
        }
        const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        list.append(new Adw.Clamp({child: chipBox, maximum_size: 800}));
        list.append(this._page);
        this._page.vexpand = true;

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
        // While searching, the chips count matches.
        const counts = taskCounts(filterTasks(tasks, null, this._terms));
        for (const [kind, chip] of this._chips)
            chip.label = `${chip._label}  ${counts[kind ?? 'all']}`;

        const shown = filterTasks(tasks, this._kind, this._terms);
        const group = new Adw.PreferencesGroup();
        if (shown.length === 0 && this._terms.length) {
            this._add(noMatchesGroup(this._query, () => this._onClearSearch()));
            return;
        }
        if (shown.length === 0) {
            group.add(new Adw.ActionRow({title: tasks.length ? _('Nothing of this kind') : _('Nothing assigned to you'),
                use_markup: false, css_classes: ['dim-label']}));
        }
        for (const task of shown)
            group.add(this._taskRow(task));
        this._add(group);
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
