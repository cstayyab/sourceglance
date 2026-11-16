import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ActionController} from './lib/actions.js';
import {installLauncher, removeLauncher} from './lib/appLauncher.js';
import {GitHubClient, GitHubError, isCancelled} from './lib/github.js';
import {ToolbarButton} from './lib/indicator.js';
import {DesktopWidgets} from './lib/widgets.js';
import {groupIssues, itemKey, mergeItems, nextRefreshDelaySeconds, normalizeButtons, normalizeWidgets} from './lib/model.js';
import {lookupToken} from './lib/tokenStore.js';

// Settings that change which top-bar buttons exist.
const TOOLBAR_KEYS = ['layout', 'toolbar-buttons'];
// Settings that don't need a refresh when they change.
const UI_ONLY_KEYS = ['start-automatically', 'start-request', 'app-launcher', 'widget-positions', 'widget-opacity'];

// Whether sourceglance runs in this session: null until the first enable() after login.
// Kept at module level because GNOME disables and re-enables extensions around the lock
// screen, and Quit should survive that.
let sessionRunning = null;

// How many items closed from the menu stay under "Recently closed" for a quick reopen.
const MAX_RECENTLY_CLOSED = 5;
// Search can list a just-closed item as open for a while; after this, believe the search.
const REOPENED_ELSEWHERE_MS = 2 * 60 * 1000;

const INITIAL_STATE = {
    status: 'loading',
    login: null,
    groups: [],
    prGroups: [],
    recentlyClosed: [],
    busy: [],
    issueTotal: 0,
    issueShown: 0,
    prTotal: 0,
    prShown: 0,
    // Closed items still assigned to you; null until counted.
    closedCounts: {issues: null, prs: null},
    // Your project boards with their draft items; null until loaded.
    boards: null,
    boardsError: null,
    updatedAt: null,
    error: null,
    refreshing: false,
    intervalMinutes: 10,
};

export default class SourceglanceExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._client = new GitHubClient(this.metadata['version-name'] ?? 'dev');
        this._state = {...INITIAL_STATE};
        this._login = null;
        this._cancellable = null;
        this._timeoutId = 0;
        this._results = null;
        this._closed = new Map();
        this._busy = new Set();

        this._actions = new ActionController({
            client: this._client,
            getToken: () => this._readToken(null),
            getLogin: () => this._login,
            setBusy: (item, busy) => this._setBusy(item, busy),
            onChanged: (item, change) => this._onItemChanged(item, change),
        });

        const icon = name => Gio.FileIcon.new(this.dir.get_child('icons').get_child(`${name}-symbolic.svg`));
        this._icons = {
            issues: Gio.ThemedIcon.new('checkbox-checked-symbolic'),
            projects: icon('checklist'),
            prs: icon('git-pull-request'),
            app: icon('sourceglance'),
            // Used inside the menus.
            issue: icon('issue'),
            issueClosed: icon('issue-closed'),
            prMerged: icon('git-merge'),
            prClosed: icon('pr-closed'),
            label: icon('label'),
        };
        this._buttons = [];
        this._running = false;

        // Debounced, so typing in the repositories field doesn't fire a request per keystroke.
        this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
            if (key === 'start-request')
                this._start();
            if (key === 'app-launcher')
                this._syncLauncher();
            if (!this._running || UI_ONLY_KEYS.includes(key))
                return;
            if (key === 'token-changed')
                this._login = null;
            if (TOOLBAR_KEYS.includes(key)) {
                this._buildButtons();
                this._setState({});
            }
            this._schedule(1);
        });

        this._syncLauncher();
        sessionRunning ??= this._settings.get_boolean('start-automatically');
        if (sessionRunning)
            this._start();
    }

    /** Adds or removes the app grid icon, following the "Show in app grid" setting. */
    _syncLauncher() {
        if (this._settings.get_boolean('app-launcher'))
            installLauncher(this.dir);
        else
            removeLauncher();
    }

    /** Shows the top-bar buttons and starts refreshing. */
    _start() {
        if (this._running)
            return;
        this._running = true;
        sessionRunning = true;
        this._buildButtons();
        this._widgets = new DesktopWidgets({
            settings: this._settings,
            icons: this._icons,
            getRepos: () => this._settings?.get_strv('repositories') ?? [],
        });
        this._widgets.update(this._state);
        this._refresh();
    }

    /** Quit: hides the buttons and stops all network activity until started again. */
    _quit() {
        this._running = false;
        sessionRunning = false;
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._actions.closeDialog();
        for (const button of this._buttons)
            button.destroy();
        this._buttons = [];
        this._widgets?.destroy();
        this._widgets = null;
        Main.notify('sourceglance', _('sourceglance has quit. To start it again, open its Settings ' +
            'from the Extensions app and choose Start now.'));
    }

    disable() {
        // sessionRunning is left as is, so the lock screen doesn't undo Quit.
        this._running = false;
        this._cancellable?.cancel();
        this._cancellable = null;

        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        this._settings = null;

        this._actions?.destroy();
        this._actions = null;

        this._client?.destroy();
        this._client = null;
        this._results = null;
        this._closed = null;
        this._busy = null;

        for (const button of this._buttons ?? [])
            button.destroy();
        this._buttons = null;
        this._widgets?.destroy();
        this._widgets = null;
        this._icons = null;

        this._state = null;
        this._login = null;
    }

    /** The lists shown in the top bar, from Settings. */
    _lists() {
        return normalizeButtons(this._settings.get_strv('toolbar-buttons'));
    }

    /**
     * (Re)creates the top-bar buttons: one per list plus the sourceglance button ("separate"),
     * or only the sourceglance button with a tab per list ("tabs").
     */
    _buildButtons() {
        for (const button of this._buttons)
            button.destroy();
        const lists = this._lists();
        const tabs = this._settings.get_string('layout') === 'tabs';
        const callbacks = {
            onRefresh: () => this._refresh(),
            onSettings: () => {
                // openPreferences() returns a promise on newer Shells; it rejects if prefs fail to open.
                Promise.resolve(this.openPreferences()).catch(e =>
                    console.warn(`sourceglance: could not open Settings: ${e.message}`));
            },
            onAction: (item, action, arg) => this._actions.run(item, action, arg),
            getRepos: () => this._settings?.get_strv('repositories') ?? [],
            getAutostart: () => this._settings?.get_boolean('start-automatically') ?? true,
            setAutostart: active => this._settings?.set_boolean('start-automatically', active),
            onQuit: () => this._quit(),
        };
        // The sourceglance button leads the group, followed by the lists.
        const ids = tabs ? ['app'] : ['app', ...lists];
        this._buttons = ids.map(id => new ToolbarButton({
            id, icons: this._icons, tabs: id === 'app' && tabs ? lists : null, ...callbacks,
        }));
        this._buttons[0].add_style_class_name('sourceglance-group-first');
        this._buttons.at(-1).add_style_class_name('sourceglance-group-last');
        // Each button is inserted at the same position, so add them right to left.
        for (let i = ids.length - 1; i >= 0; i--)
            Main.panel.addToStatusArea(`${this.uuid}-${ids[i]}`, this._buttons[i]);
        if (this._state)
            this._buttons.forEach(button => button.render(this._state));
    }

    _setState(patch) {
        if (!this._buttons)
            return;
        this._state = {...this._state, ...patch};
        for (const button of this._buttons)
            button.render(this._state);
        this._widgets?.update(this._state);
    }

    _setBusy(item, busy) {
        if (!this._busy)
            return;
        if (busy)
            this._busy.add(itemKey(item));
        else
            this._busy.delete(itemKey(item));
        this._setState({busy: [...this._busy]});
    }

    _onItemChanged(item, change) {
        if (!this._closed)
            return;
        if (change === 'closed') {
            this._closed.delete(itemKey(item));
            this._closed.set(itemKey(item), {...item, state: 'closed', closedAt: Date.now()});
            while (this._closed.size > MAX_RECENTLY_CLOSED)
                this._closed.delete(this._closed.keys().next().value);
        } else if (change === 'reopened') {
            this._closed.delete(itemKey(item));
        }
        this._publish();
        // GitHub's search index lags a few seconds behind writes.
        this._schedule(3);
    }

    /**
     * Adds project board info to the listed items. Optional: if the sign-in can't read
     * projects, the menu just shows no boards.
     */
    async _loadBoards(token, items, cancellable) {
        try {
            const boards = await this._client.getProjectBoards(token, items.map(item => item.nodeId), cancellable);
            for (const item of items)
                item.boards = boards.get(item.nodeId) ?? [];
            this._publish();
        } catch (e) {
            if (isCancelled(e))
                throw e;
            if (!this._boardsWarned) {
                this._boardsWarned = true;
                console.warn(`sourceglance: project boards unavailable: ${e.kind ?? e.message}`);
            }
        }
    }

    /** Loads your boards and their draft items for the Projects list. Optional, like _loadBoards(). */
    async _loadViewerBoards(token, cancellable) {
        try {
            const boards = await this._client.getViewerBoards(token, cancellable);
            this._setState({boards, boardsError: null});
        } catch (e) {
            if (isCancelled(e))
                throw e;
            console.warn(`sourceglance: project boards unavailable: ${e.kind ?? e.message}`);
            this._setState({boardsError: e.kind ?? 'unknown'});
        }
    }

    /** Pushes the latest search results to the menu, hiding items closed from the menu. */
    _publish() {
        if (!this._results)
            return;
        const {issues, prs, issueTotal, prTotal} = this._results;
        // Still open in search long after we closed it: it was reopened elsewhere.
        for (const item of [...issues, ...prs]) {
            const closed = this._closed.get(itemKey(item));
            if (closed && Date.now() - closed.closedAt > REOPENED_ELSEWHERE_MS)
                this._closed.delete(itemKey(item));
        }
        const visible = list => list.filter(item => !this._closed.has(itemKey(item)));
        const shownIssues = visible(issues);
        const shownPrs = visible(prs);
        this._setState({
            groups: groupIssues(shownIssues),
            prGroups: groupIssues(shownPrs),
            recentlyClosed: [...this._closed.values()].reverse(),
            issueTotal: Math.max(0, issueTotal - (issues.length - shownIssues.length)),
            issueShown: shownIssues.length,
            prTotal: Math.max(0, prTotal - (prs.length - shownPrs.length)),
            prShown: shownPrs.length,
        });
    }

    _schedule(seconds) {
        if (!this._running)
            return;
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._timeoutId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _readToken(cancellable) {
        try {
            return await lookupToken(cancellable);
        } catch (e) {
            if (isCancelled(e))
                throw e;
            // A locked or missing keyring is treated as signed out (ADR 0002).
            console.warn(`sourceglance: keyring unavailable: ${e.message}`);
            return null;
        }
    }

    async _refresh() {
        if (!this._running)
            return;
        // A new refresh replaces any running one.
        this._cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;

        const intervalMinutes = this._settings.get_int('refresh-interval');
        this._setState({refreshing: true, intervalMinutes});

        let error = null;
        try {
            const token = await this._readToken(cancellable);
            if (!token) {
                this._login = null;
                this._results = null;
                this._closed.clear();
                this._setState({...INITIAL_STATE, status: 'signed-out', intervalMinutes});
                return;
            }
            if (this._state.status === 'signed-out')
                this._setState({status: 'loading'});

            this._login ??= await this._client.getViewer(token, cancellable);
            const repos = this._settings.get_strv('repositories');
            // The closed counts only fill the list footers, so a failure there isn't fatal.
            const count = search => this._client.countSearch(token, repos, search, cancellable)
                .catch(e => {
                    if (isCancelled(e))
                        throw e;
                    return null;
                });
            const [issues, assigned, review, closedIssues, closedPrs] = await Promise.all([
                ...['issue', 'pr-assigned', 'pr-review'].map(search =>
                    this._client.search(token, repos, search, cancellable)),
                count('issue-closed'),
                count('pr-closed'),
            ]);
            const prs = mergeItems(assigned.items, review.items);
            // Results past the first page of either PR search aren't in `prs`.
            const prTotal = prs.length + Math.max(0, assigned.total - assigned.items.length) +
                Math.max(0, review.total - review.items.length);

            // Show boards from the last refresh until the new ones arrive.
            const previous = new Map([...this._results?.issues ?? [], ...this._results?.prs ?? []]
                .map(item => [itemKey(item), item.boards]));
            const all = [...issues.items, ...prs];
            for (const item of all)
                item.boards = previous.get(itemKey(item)) ?? [];

            this._results = {issues: issues.items, prs, issueTotal: issues.total, prTotal};
            this._setState({
                status: 'ready',
                login: this._login,
                closedCounts: {issues: closedIssues, prs: closedPrs},
                updatedAt: new Date(),
                error: null,
                refreshing: false,
            });
            this._publish();
            await this._loadBoards(token, all, cancellable);
            // Boards feed the Projects list and the projects and summary widgets.
            const widgets = normalizeWidgets(this._settings.get_strv('widgets'));
            if (this._lists().includes('projects') || widgets.includes('projects') || widgets.includes('summary'))
                await this._loadViewerBoards(token, cancellable);
        } catch (e) {
            if (isCancelled(e) || cancellable.is_cancelled())
                return;
            if (e instanceof GitHubError) {
                error = {kind: e.kind, retryAt: e.retryAt};
                if (e.kind === 'auth')
                    this._login = null;
            } else {
                error = {kind: 'unknown', retryAt: null};
                console.error('sourceglance: refresh failed', e);
            }
            this._setState({status: 'error', login: this._login, error, refreshing: false});
        } finally {
            if (this._cancellable === cancellable) {
                this._cancellable = null;
                this._schedule(nextRefreshDelaySeconds(intervalMinutes, error));
            }
        }
    }
}
