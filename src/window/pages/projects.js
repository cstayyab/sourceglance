// Lists → Projects: your boards' draft items (cards that are neither issues nor PRs),
// grouped by board and status, with Move to status and Open board.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {
    draftTarget,
    groupCollapseId,
    groupDraftsByStatus,
    isDoneStatus,
    isGroupCollapsed,
    itemKey,
    searchBoards,
    toggleId,
} from '../../lib/model.js';
import {actionButton, collapsibleGroup, noMatchesGroup, statusText} from './common.js';

export class ProjectsPage {
    /** `onClearSearch` empties the window's search box. */
    constructor({icons, actions, settings, onClearSearch}) {
        this._icons = icons;
        this._actions = actions;
        this._settings = settings;
        this._onClearSearch = onClearSearch;
        this._groups = [];
        this._state = null;
        this._query = '';
        this._terms = [];
        this._statusPage = new Adw.StatusPage();
        this._page = new Adw.PreferencesPage();
        this.widget = new Gtk.Stack({transition_type: Gtk.StackTransitionType.CROSSFADE});
        this.widget.add_named(this._statusPage, 'status');
        this.widget.add_named(this._page, 'list');
    }

    _status(icon, title, description) {
        this._statusPage.set({icon_name: icon, title, description});
        this.widget.visible_child_name = 'status';
    }

    /** Shows only the drafts matching `terms`; [] shows them all again. */
    setSearch(query, terms) {
        this._query = query;
        this._terms = terms;
        if (this._state)
            this.update(this._state);
    }

    _clear() {
        for (const group of this._groups)
            this._page.remove(group);
        this._groups = [];
    }

    _add(group) {
        this._page.add(group);
        this._groups.push(group);
    }

    update(state) {
        this._state = state;
        const status = statusText(state);
        if (status) {
            this._status(status.icon, status.title, status.description);
            return;
        }
        if (state.boardsError) {
            this._status('dialog-warning-symbolic', _('Can’t read your project boards'),
                _('Organization boards need the Source Glance app installed on the organization.'));
            return;
        }
        if (state.boards === null) {
            this._status('content-loading-symbolic', _('Loading project boards…'), '');
            return;
        }
        if (!state.boards.some(board => board.drafts.length > 0)) {
            this._status('object-select-symbolic', _('No draft items'),
                _('Issues and pull requests on your boards are in their own lists.'));
            return;
        }
        const boards = searchBoards(state.boards, this._terms).filter(board => board.drafts.length > 0);

        this.widget.visible_child_name = 'list';
        this._clear();
        if (boards.length === 0) {
            this._add(noMatchesGroup(this._query, () => this._onClearSearch()));
            return;
        }
        const collapsedGroups = this._settings.get_strv('collapsed-groups');
        for (const board of boards) {
            let open = null;
            if (board.url) {
                open = new Gtk.Button({icon_name: 'web-browser-symbolic', tooltip_text: _('Open board'),
                    css_classes: ['flat'], valign: Gtk.Align.CENTER});
                open.connect('clicked', () => this._actions.open(board.url));
            }
            const id = groupCollapseId('projects', 'github', board.projectId);
            const collapsed = isGroupCollapsed(collapsedGroups, id, this._terms);
            const group = collapsibleGroup({
                title: board.title, count: board.drafts.length, collapsed, toggleable: this._terms.length === 0,
                suffix: open,
                onToggle: () => {
                    this._settings.set_strv('collapsed-groups', toggleId(this._settings.get_strv('collapsed-groups'), id));
                    this.update(this._state);
                },
            });
            if (!collapsed) {
                for (const status of groupDraftsByStatus(board)) {
                    for (const draft of status.drafts)
                        group.add(this._draftRow(board, draft, status.status, state.busy));
                }
            }
            this._add(group);
        }
    }

    _draftRow(board, draft, statusName, busyKeys) {
        const {item, board: target} = draftTarget(board, draft);
        const busy = busyKeys.includes(itemKey(item));
        const row = new Adw.ExpanderRow({
            title: draft.title || _('Untitled draft'),
            subtitle: busy ? _('Working…') : statusName ?? _('No status'),
            use_markup: false,
        });
        row.add_prefix(isDoneStatus(draft.status)
            ? new Gtk.Image({gicon: this._icons.issueClosed})
            : new Gtk.Image({icon_name: 'document-edit-symbolic'}));
        const buttons = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, column_spacing: 6, row_spacing: 6,
            margin_top: 8, margin_bottom: 8, margin_start: 12, margin_end: 12, sensitive: !busy});
        const move = actionButton({gicon: this._icons.projects, label: _('Move to status'),
            onClick: () => this._actions.status(item, target)});
        move.sensitive = Boolean(board.fieldId) && board.options.length > 0;
        buttons.append(move);
        if (board.url) {
            buttons.append(actionButton({iconName: 'web-browser-symbolic', label: _('Open board'),
                onClick: () => this._actions.open(board.url)}));
        }
        row.add_row(new Gtk.ListBoxRow({child: buttons, activatable: false, selectable: false}));
        return row;
    }
}
