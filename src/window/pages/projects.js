// Lists → Projects: your boards' draft items (cards that are neither issues nor PRs),
// grouped by board and status, with Move to status and Open board. Boards are GitHub's; with
// several GitHub accounts, each account's boards follow its name.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {
    groupCollapseId,
    groupDraftsByStatus,
    isGroupCollapsed,
    searchBoards,
    toggleId,
} from '../../lib/model.js';
import {collapsibleGroup, draftRow, noMatchesGroup, statusText} from './common.js';

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
        const sources = state.sources.filter(src => src.platform === 'github' && src.status !== 'signed-out');
        if (sources.length === 0) {
            this._status('avatar-default-symbolic', _('No GitHub account'),
                _('Project boards come from GitHub. Add a GitHub account under Settings → Accounts.'));
            return;
        }
        const readable = sources.filter(src => !src.boardsError);
        if (readable.length === 0) {
            this._status('dialog-warning-symbolic', _('Can’t read your project boards'),
                _('Organization boards need the Source Glance app installed on the organization.'));
            return;
        }
        if (readable.every(src => src.boards === null)) {
            this._status('content-loading-symbolic', _('Loading project boards…'), '');
            return;
        }
        if (!readable.some(src => (src.boards ?? []).some(board => board.drafts.length > 0))) {
            this._status('object-select-symbolic', _('No draft items'),
                _('Issues and pull requests on your boards are in their own lists.'));
            return;
        }

        this.widget.visible_child_name = 'list';
        this._clear();
        const matching = readable.map(src => ({src,
            boards: searchBoards(src.boards ?? [], this._terms).filter(board => board.drafts.length > 0)}));
        if (matching.every(({boards}) => boards.length === 0)) {
            this._add(noMatchesGroup(this._query, () => this._onClearSearch()));
            return;
        }
        for (const {src, boards} of matching) {
            if (boards.length === 0)
                continue;
            if (readable.length > 1)
                this._add(new Adw.PreferencesGroup({title: src.title}));
            this._addBoards(src, boards, state);
        }
    }

    _addBoards(src, boards, state) {
        const collapsedGroups = this._settings.get_strv('collapsed-groups');
        for (const board of boards) {
            let open = null;
            if (board.url) {
                open = new Gtk.Button({icon_name: 'web-browser-symbolic', tooltip_text: _('Open board'),
                    css_classes: ['flat'], valign: Gtk.Align.CENTER});
                open.connect('clicked', () => this._actions.open(board.url));
            }
            const id = groupCollapseId('projects', src.key, board.projectId);
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

    _draftRow(board, draft, _statusName, busyKeys) {
        return draftRow({board, draft, busyKeys, icons: this._icons, actions: this._actions});
    }
}
