// What each top-bar list shows. Each view fills a PopupMenu from the state (see indicator.js).
// `ui` is {menu, state, filters, scheduleRebuild, onAction, onRefresh, onSettings, repos}.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    countLabel,
    draftTarget,
    filterByLabel,
    groupDraftsByStatus,
    isSafeGitHubUrl,
    isValidLogin,
    itemKey,
    labelOptions,
    relativeTime,
    searchPageUrl,
    truncate,
} from './model.js';

function formatRelative(date) {
    const {unit, value} = relativeTime(date);
    switch (unit) {
    case 'now':
        return _('just now');
    case 'minute':
        return ngettext('%d min ago', '%d min ago', value).format(value);
    case 'hour':
        return ngettext('%d hour ago', '%d hours ago', value).format(value);
    default:
        return ngettext('%d day ago', '%d days ago', value).format(value);
    }
}

function formatClock(ms) {
    return GLib.DateTime.new_from_unix_local(Math.floor(ms / 1000)).format('%H:%M');
}

function errorText(error, intervalMinutes) {
    switch (error.kind) {
    case 'auth':
        return _('Your sign-in was rejected. Sign in again in Settings.');
    case 'forbidden':
        return _('Your sign-in can’t read these issues. Check its permissions in Settings.');
    case 'rate-limit':
        return error.retryAt
            ? _('GitHub rate limit reached. Retrying at %s.').format(formatClock(error.retryAt))
            : _('GitHub rate limit reached. Retrying later.');
    case 'query':
        return _('A watched repository doesn’t exist or isn’t visible to your sign-in. Check Settings.');
    default:
        return ngettext('Couldn’t reach GitHub. Retrying in %d min.',
            'Couldn’t reach GitHub. Retrying in %d min.', intervalMinutes).format(intervalMinutes);
    }
}

// A choice in a label dropdown. It doesn't emit 'activate', so picking a label filters the
// list without closing the menu.
const FilterItem = GObject.registerClass(
class FilterItem extends PopupMenu.PopupMenuItem {
    _init(text, onPick) {
        super._init(text);
        this._onPick = onPick;
    }

    activate(_event) {
        this._onPick();
    }
});

export function openUri(uri) {
    if (!isSafeGitHubUrl(uri)) {
        console.warn('sourceglance: refusing to open a non-GitHub link');
        return;
    }
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        console.error(`sourceglance: could not open ${uri}`, e);
    }
}

function addInfo(ui, text, styleClass) {
    const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
    item.label.clutter_text.line_wrap = true;
    item.label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    item.add_style_class_name(styleClass);
    ui.menu.addMenuItem(item);
    return item;
}

function addAction(ui, text, callback) {
    const item = new PopupMenu.PopupMenuItem(text);
    item.connect('activate', callback);
    ui.menu.addMenuItem(item);
    return item;
}

function signedIn(state) {
    return state.status === 'ready' || state.status === 'error';
}

/** True if the list has data to show; otherwise adds a short status message. */
function listReady(ui) {
    const {state} = ui;
    if (state.status === 'signed-out') {
        addInfo(ui, _('Not signed in. Open the sourceglance menu to sign in.'), 'sourceglance-message');
        return false;
    }
    if (state.status === 'loading') {
        addInfo(ui, _('Loading…'), 'sourceglance-message');
        return false;
    }
    if (state.status === 'error')
        addInfo(ui, errorText(state.error, state.intervalMinutes), 'sourceglance-message');
    return state.status === 'ready' || state.updatedAt !== null;
}

// Badge text for a list's top-bar button or tab: '' hides it.
export function badgeText(id, state) {
    if (!signedIn(state))
        return '';
    switch (id) {
    case 'issues':
        return countLabel(state.issueTotal, state.issueShown);
    case 'prs':
        return countLabel(state.prTotal, state.prShown);
    case 'projects': {
        const drafts = (state.boards ?? []).reduce((sum, board) => sum + board.drafts.length, 0);
        return drafts > 0 ? String(drafts) : '';
    }
    default:
        return '';
    }
}

function itemLabel(item) {
    const label = `#${item.number}  ${truncate(item.title)}`;
    return item.kind === 'pr' && item.reason === 'review'
        ? _('%s · review requested').format(label)
        : label;
}

/** An issue or PR row with its actions in a submenu. */
function addItem(ui, item) {
    const busy = ui.state.busy.includes(itemKey(item));
    const row = new PopupMenu.PopupSubMenuMenuItem(busy ? _('%s · working…').format(itemLabel(item)) : itemLabel(item));
    row.add_style_class_name('sourceglance-issue');
    ui.menu.addMenuItem(row);

    const add = (text, callback) => {
        const entry = row.menu.addAction(text, callback);
        entry.setSensitive(!busy);
        return entry;
    };
    add(_('Open on GitHub'), () => openUri(item.url)).setSensitive(Boolean(item.url));
    if (item.state === 'closed') {
        add(_('Reopen'), () => ui.onAction(item, 'reopen'));
        return;
    }
    add(_('Comment…'), () => ui.onAction(item, 'comment'));
    add(item.kind === 'pr' ? _('Close pull request…') : _('Close issue…'), () => ui.onAction(item, 'close'));
    add(_('Assignees…'), () => ui.onAction(item, 'assignees'));
    add(_('Labels…'), () => ui.onAction(item, 'labels'));
    for (const board of item.boards ?? []) {
        add(_('%s: %s…').format(truncate(board.title, 30), board.status ?? _('No status')),
            () => ui.onAction(item, 'status', board));
    }
}

/** A section heading with a label filter dropdown, then its items grouped by repository. */
function addSection(ui, title, groups, key) {
    const options = labelOptions(groups);
    let filter = ui.filters[key];
    // The label disappeared after a refresh: show everything again.
    if (filter !== null && !options.some(option => option.name === filter))
        filter = ui.filters[key] = null;

    if (options.length === 0) {
        addInfo(ui, title, 'sourceglance-section');
    } else {
        const header = new PopupMenu.PopupSubMenuMenuItem(title);
        header.add_style_class_name('sourceglance-section');
        const current = new St.Label({
            text: filter === null ? _('All labels') : truncate(filter, 24),
            style_class: 'sourceglance-filter',
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (header._triangleBin)
            header.insert_child_below(current, header._triangleBin);
        else
            header.add_child(current);
        ui.menu.addMenuItem(header);

        const pick = name => {
            ui.filters[key] = name;
            ui.scheduleRebuild();
        };
        const all = new FilterItem(_('All labels'), () => pick(null));
        all.setOrnament(filter === null ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        header.menu.addMenuItem(all);
        for (const option of options) {
            const entry = new FilterItem(`${truncate(option.name, 40)} (${option.count})`, () => pick(option.name));
            entry.setOrnament(filter === option.name ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            header.menu.addMenuItem(entry);
        }
    }

    for (const group of filterByLabel(groups, filter)) {
        addInfo(ui, group.repo, 'sourceglance-repo');
        for (const item of group.issues)
            addItem(ui, item);
    }
}

/** The always-visible footer: closed items still assigned to you, linking to them on GitHub. */
function addClosedFooter(ui, count, search, text) {
    ui.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    const label = count === null ? text(null) : text(count);
    const row = addAction(ui, label, () => openUri(searchPageUrl(search, ui.repos)));
    row.add_style_class_name('sourceglance-footer');
}

function renderItemList(ui, {key, kind, title, empty, closedSearch, closedText, groups}) {
    if (listReady(ui)) {
        if (groups.length === 0)
            addInfo(ui, empty, 'sourceglance-message');
        else
            addSection(ui, title, groups, key);

        const closed = ui.state.recentlyClosed.filter(item => item.kind === kind);
        if (closed.length > 0) {
            addInfo(ui, _('Recently closed'), 'sourceglance-section');
            for (const item of closed)
                addItem(ui, item);
        }
    }
    if (signedIn(ui.state))
        addClosedFooter(ui, ui.state.closedCounts[key], closedSearch, closedText);
}

export function renderIssues(ui) {
    renderItemList(ui, {
        key: 'issues',
        kind: 'issue',
        title: _('Issues'),
        empty: _('No open issues assigned to you'),
        groups: ui.state.groups,
        closedSearch: 'issue-closed',
        closedText: n => n === null
            ? _('Closed issues still assigned to you')
            : ngettext('%d closed issue still assigned to you', '%d closed issues still assigned to you', n).format(n),
    });
}

export function renderPrs(ui) {
    renderItemList(ui, {
        key: 'prs',
        kind: 'pr',
        title: _('Pull requests'),
        empty: _('No open pull requests for you'),
        groups: ui.state.prGroups,
        closedSearch: 'pr-closed',
        closedText: n => n === null
            ? _('Closed pull requests still assigned to you')
            : ngettext('%d closed pull request still assigned to you',
                '%d closed pull requests still assigned to you', n).format(n),
    });
}

export function renderProjects(ui) {
    if (!listReady(ui))
        return;
    const {boards, boardsError, busy} = ui.state;
    if (boardsError) {
        addInfo(ui, _('sourceglance can’t read your project boards. Organization boards need the ' +
            'app installed on the organization.'), 'sourceglance-message');
        return;
    }
    if (boards === null) {
        addInfo(ui, _('Loading project boards…'), 'sourceglance-message');
        return;
    }
    const withDrafts = boards.filter(board => board.drafts.length > 0);
    if (withDrafts.length === 0) {
        addInfo(ui, _('No draft items on your project boards'), 'sourceglance-message');
        return;
    }
    for (const board of withDrafts) {
        const header = addAction(ui, truncate(board.title, 48), () => openUri(board.url));
        header.add_style_class_name('sourceglance-section');
        header.setSensitive(Boolean(board.url));
        for (const group of groupDraftsByStatus(board)) {
            addInfo(ui, group.status ?? _('No status'), 'sourceglance-repo');
            for (const draft of group.drafts) {
                const {item, board: target} = draftTarget(board, draft);
                const isBusy = busy.includes(itemKey(item));
                const title = truncate(draft.title || _('Untitled draft'));
                const row = new PopupMenu.PopupSubMenuMenuItem(isBusy ? _('%s · working…').format(title) : title);
                row.add_style_class_name('sourceglance-issue');
                ui.menu.addMenuItem(row);
                const move = row.menu.addAction(_('Move to status…'), () => ui.onAction(item, 'status', target));
                move.setSensitive(!isBusy && Boolean(board.fieldId) && board.options.length > 0);
                row.menu.addAction(_('Open board'), () => openUri(board.url)).setSensitive(Boolean(board.url));
            }
        }
        if (board.truncated)
            addAction(ui, _('More on GitHub'), () => openUri(board.url)).setSensitive(Boolean(board.url));
    }
}

function headerText(state) {
    const {status, login, refreshing, updatedAt} = state;
    if (status === 'signed-out')
        return _('Sign in to see your GitHub issues');
    if (!login)
        return status === 'error' ? _('GitHub') : _('Loading…');
    if (refreshing)
        return _('@%s · Refreshing…').format(login);
    if (updatedAt)
        return _('@%s · updated %s').format(login, formatRelative(updatedAt));
    return `@${login}`;
}

/** The sourceglance list: status, profile, Refresh and Settings. */
export function renderApp(ui) {
    const {state} = ui;
    addInfo(ui, headerText(state), 'sourceglance-header');
    if (state.status === 'error')
        addInfo(ui, errorText(state.error, state.intervalMinutes), 'sourceglance-message');
    ui.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    if (signedIn(state)) {
        if (isValidLogin(state.login))
            addAction(ui, _('Your GitHub profile'), () => openUri(`https://github.com/${state.login}`));
        addAction(ui, _('Refresh'), () => ui.onRefresh()).setSensitive(!state.refreshing);
    }
    addAction(ui, signedIn(state) ? _('Settings') : _('Sign in…'), () => ui.onSettings());
}

export const VIEWS = {issues: renderIssues, projects: renderProjects, prs: renderPrs, app: renderApp};
