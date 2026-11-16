// Lists → Projects: your boards' draft items (cards that are neither issues nor PRs),
// grouped by board and status, with Move to status and Open board.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {draftTarget, groupDraftsByStatus, isDoneStatus, itemKey} from '../../lib/model.js';
import {actionButton, statusText} from './common.js';

export class ProjectsPage {
    constructor({icons, actions}) {
        this._icons = icons;
        this._actions = actions;
        this._groups = [];
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

    update(state) {
        const status = statusText(state);
        if (status) {
            this._status(status.icon, status.title, status.description);
            return;
        }
        if (state.boardsError) {
            this._status('dialog-warning-symbolic', _('Can’t read your project boards'),
                _('Organization boards need the sourceglance app installed on the organization.'));
            return;
        }
        if (state.boards === null) {
            this._status('content-loading-symbolic', _('Loading project boards…'), '');
            return;
        }
        const boards = state.boards.filter(board => board.drafts.length > 0);
        if (boards.length === 0) {
            this._status('object-select-symbolic', _('No draft items'),
                _('Issues and pull requests on your boards are in their own lists.'));
            return;
        }

        this.widget.visible_child_name = 'list';
        for (const group of this._groups)
            this._page.remove(group);
        this._groups = [];
        for (const board of boards) {
            const group = new Adw.PreferencesGroup({title: GLib.markup_escape_text(board.title, -1)});
            if (board.url) {
                const open = new Gtk.Button({icon_name: 'web-browser-symbolic', tooltip_text: _('Open board'),
                    css_classes: ['flat'], valign: Gtk.Align.CENTER});
                open.connect('clicked', () => this._actions.open(board.url));
                group.set_header_suffix(open);
            }
            for (const status of groupDraftsByStatus(board)) {
                for (const draft of status.drafts)
                    group.add(this._draftRow(board, draft, status.status, state.busy));
            }
            this._page.add(group);
            this._groups.push(group);
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
