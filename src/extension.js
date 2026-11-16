import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ActionController} from './lib/actions.js';
import {GitHubClient, GitHubError, isCancelled} from './lib/github.js';
import {Indicator} from './lib/indicator.js';
import {groupIssues, itemKey, mergeItems, nextRefreshDelaySeconds} from './lib/model.js';
import {lookupToken} from './lib/tokenStore.js';

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
    total: 0,
    shown: 0,
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

        this._indicator = new Indicator({
            onRefresh: () => this._refresh(),
            onSettings: () => {
                // openPreferences() returns a promise on newer Shells; it rejects if prefs fail to open.
                Promise.resolve(this.openPreferences()).catch(e =>
                    console.warn(`sourceglance: could not open Settings: ${e.message}`));
            },
            onAction: (item, action, arg) => this._actions.run(item, action, arg),
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Debounced, so typing in the repositories field doesn't fire a request per keystroke.
        this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
            if (key === 'token-changed')
                this._login = null;
            this._schedule(1);
        });

        this._refresh();
    }

    disable() {
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

        this._indicator?.destroy();
        this._indicator = null;

        this._state = null;
        this._login = null;
    }

    _setState(patch) {
        if (!this._indicator)
            return;
        this._state = {...this._state, ...patch};
        this._indicator.render(this._state);
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
        const hidden = issues.length + prs.length - shownIssues.length - shownPrs.length;
        this._setState({
            groups: groupIssues(shownIssues),
            prGroups: groupIssues(shownPrs),
            recentlyClosed: [...this._closed.values()].reverse(),
            total: Math.max(0, issueTotal + prTotal - hidden),
            shown: shownIssues.length + shownPrs.length,
        });
    }

    _schedule(seconds) {
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
            const [issues, assigned, review] = await Promise.all(
                ['issue', 'pr-assigned', 'pr-review'].map(search =>
                    this._client.search(token, repos, search, cancellable)));
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
                updatedAt: new Date(),
                error: null,
                refreshing: false,
            });
            this._publish();
            await this._loadBoards(token, all, cancellable);
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
