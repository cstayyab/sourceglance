// The window's copy of the lists: loads them on open, on the refresh interval and after a
// change, and tells the pages. Signed out or failing loads show as a status.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {GitHubError, isCancelled} from '../lib/github.js';
import {loadGitLab} from '../lib/gitlabLoader.js';
import {loadLists} from '../lib/loader.js';
import {groupIssues} from '../lib/model.js';
import {lookupToken} from '../lib/tokenStore.js';

export class WindowData {
    /** onChange(state) runs after every change; state is shaped like the extension's. */
    constructor({client, gitlabClient, settings, onChange}) {
        this._client = client;
        this._gitlabClient = gitlabClient;
        this._settings = settings;
        this._onChange = onChange;
        this._cancellable = null;
        this._timeoutId = 0;
        this._afterChangeId = 0;
        this.state = {status: 'loading', login: null, updatedAt: null, groups: [], prGroups: [],
            issueTotal: 0, issueShown: 0, prTotal: 0, prShown: 0, closedCounts: {issues: null, prs: null},
            boards: null, boardsError: null, error: null, busy: [], gitlab: {status: 'signed-out'}};
    }

    start() {
        this.refresh();
    }

    stop() {
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        if (this._afterChangeId)
            GLib.source_remove(this._afterChangeId);
        this._afterChangeId = 0;
    }

    token() {
        return lookupToken();
    }

    setBusy(key, busy) {
        const set = new Set(this.state.busy);
        if (busy)
            set.add(key);
        else
            set.delete(key);
        this._set({busy: [...set]});
    }

    _set(patch) {
        this.state = {...this.state, ...patch};
        this._onChange(this.state);
    }

    _schedule() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            Math.max(1, this._settings.get_int('refresh-interval')) * 60, () => {
                this._timeoutId = 0;
                this.refresh();
                return GLib.SOURCE_REMOVE;
            });
    }

    /** Reloads now and once more shortly after: GitHub's search index lags behind writes. */
    refreshAfterChange() {
        this.refresh({nudge: true});
        if (this._afterChangeId)
            GLib.source_remove(this._afterChangeId);
        this._afterChangeId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
            this._afterChangeId = 0;
            this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Loads GitLab next to GitHub; its errors only mark the GitLab sections. */
    async _loadGitLab(cancellable) {
        try {
            const gl = await loadGitLab(this._gitlabClient, cancellable);
            this._set({gitlab: gl.status === 'signed-out' ? gl : {
                ...gl,
                groups: groupIssues(gl.issues),
                prGroups: groupIssues(gl.prs),
                issueShown: gl.issues.length,
                prShown: gl.prs.length,
            }});
        } catch (e) {
            if (isCancelled(e) || cancellable.is_cancelled())
                return;
            this._set({gitlab: {...this.state.gitlab, status: 'error', error: {kind: e.kind ?? 'unknown'}}});
        }
    }

    /** Reloads everything. `nudge` also asks the top bar to refresh (after a change). */
    async refresh({nudge = false} = {}) {
        this._cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        if (nudge)
            this._settings.set_int('refresh-request', this._settings.get_int('refresh-request') + 1);
        this._set({refreshing: true});
        // Development only: show fixed data from a JSON file (screenshots, UI tests).
        const fake = GLib.getenv('SOURCEGLANCE_FAKE_LISTS');
        if (fake) {
            const [, bytes] = GLib.file_get_contents(fake);
            this._set({...JSON.parse(new TextDecoder().decode(bytes)), updatedAt: new Date(), refreshing: false});
            this._cancellable = null;
            return;
        }
        const gitlabDone = this._loadGitLab(cancellable);
        try {
            const token = await lookupToken(cancellable);
            if (!token) {
                this._set({status: 'signed-out', login: null, refreshing: false});
                return;
            }
            const lists = await loadLists(this._client, token, {
                repos: this._settings.get_strv('repositories'),
                // The window always has a Projects page, whatever the top bar shows.
                projects: true,
            }, cancellable);
            this._set({
                status: 'ready',
                login: lists.login,
                updatedAt: new Date(),
                error: null,
                refreshing: false,
                groups: groupIssues(lists.issues),
                prGroups: groupIssues(lists.prs),
                issueTotal: lists.issueTotal,
                issueShown: lists.issues.length,
                prTotal: lists.prTotal,
                prShown: lists.prs.length,
                closedCounts: lists.closedCounts,
                boards: lists.boards,
                boardsError: lists.boardsError,
            });
        } catch (e) {
            if (isCancelled(e) || cancellable.is_cancelled())
                return;
            if (!(e instanceof GitHubError))
                console.error('sourceglance window: load failed', e);
            this._set({status: 'error', refreshing: false,
                error: {kind: e instanceof GitHubError ? e.kind : 'unknown', retryAt: e.retryAt ?? null}});
        } finally {
            await gitlabDone;
            if (this._cancellable === cancellable) {
                this._cancellable = null;
                this._schedule();
            }
        }
    }
}
