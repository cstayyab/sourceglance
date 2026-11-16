import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GitHubClient, GitHubError, isCancelled} from './lib/github.js';
import {Indicator} from './lib/indicator.js';
import {groupIssues, nextRefreshDelaySeconds} from './lib/model.js';
import {lookupToken} from './lib/tokenStore.js';

const INITIAL_STATE = {
    status: 'loading',
    login: null,
    groups: [],
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

        this._indicator = new Indicator({
            onRefresh: () => this._refresh(),
            onSettings: () => this.openPreferences(),
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

        this._client?.destroy();
        this._client = null;

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
                this._setState({...INITIAL_STATE, status: 'signed-out', intervalMinutes});
                return;
            }
            if (this._state.status === 'signed-out')
                this._setState({status: 'loading'});

            this._login ??= await this._client.getViewer(token, cancellable);
            const repos = this._settings.get_strv('repositories');
            const {total, issues} = await this._client.searchAssignedIssues(token, repos, cancellable);

            this._setState({
                status: 'ready',
                login: this._login,
                groups: groupIssues(issues),
                total,
                shown: issues.length,
                updatedAt: new Date(),
                error: null,
                refreshing: false,
            });
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
