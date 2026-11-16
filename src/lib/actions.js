// Runs menu actions: opens the dialog, sends the requests, reports the outcome.
// Every write starts from a user click; closing also needs a confirmation.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {CloseDialog, CommentDialog, PickerDialog} from './dialogs.js';
import {GitHubError, isCancelled} from './github.js';
import {
    addLabelsRequest,
    assigneesRequest,
    closeRequest,
    commentRequest,
    diffSelection,
    removeLabelRequest,
    reopenRequest,
} from './model.js';

// Repository labels and assignable users change rarely; refetch after this long.
const LIST_CACHE_MS = 5 * 60 * 1000;

function actionErrorText(error) {
    if (!(error instanceof GitHubError))
        return _('Something went wrong: %s').format(error.message);
    switch (error.kind) {
    case 'auth':
        return _('Your sign-in was rejected. Sign in again in Settings.');
    case 'forbidden':
        return _('Your sign-in can’t change this. Check its permissions in Settings.');
    case 'not-found':
        return _('It no longer exists, or your sign-in can’t see it.');
    case 'gone':
        return _('Issues are turned off in this repository.');
    case 'query':
        return _('GitHub didn’t accept this change.');
    case 'rate-limit':
        return _('GitHub rate limit reached. Try again later.');
    case 'network':
        return _('Couldn’t reach GitHub. Check your connection.');
    default:
        return _('GitHub returned an error (HTTP %d).').format(error.status);
    }
}

export class ActionController {
    /**
     * @param {object} params
     * @param {GitHubClient} params.client
     * @param {() => Promise<string|null>} params.getToken
     * @param {() => string|null} params.getLogin
     * @param {(item, busy: boolean) => void} params.setBusy
     * @param {(item, change: 'closed'|'reopened'|'updated') => void} params.onChanged
     */
    constructor({client, getToken, getLogin, setBusy, onChanged}) {
        this._client = client;
        this._getToken = getToken;
        this._getLogin = getLogin;
        this._setBusy = setBusy;
        this._onChanged = onChanged;
        this._dialog = null;
        this._cache = new Map();
    }

    destroy() {
        this._dialog?.close();
        this._dialog = null;
        this._cache.clear();
        this._client = null;
    }

    run(item, action) {
        switch (action) {
        case 'comment':
            this._open(new CommentDialog(item, text =>
                this._send(item, [commentRequest(item, text)], _('Comment posted'), 'updated')));
            break;
        case 'close':
            this._open(new CloseDialog(item, reason =>
                this._send(item, [closeRequest(item, reason)], _('Closed'), 'closed')));
            break;
        case 'reopen':
            this._send(item, [reopenRequest(item)], _('Reopened'), 'reopened');
            break;
        case 'assignees':
            this._pickAssignees(item);
            break;
        case 'labels':
            this._pickLabels(item);
            break;
        }
    }

    _open(dialog) {
        this._dialog?.close();
        this._dialog = dialog;
        dialog.connect('closed', () => {
            if (this._dialog === dialog)
                this._dialog = null;
        });
        dialog.open();
    }

    async _cachedList(kind, repo, fetch) {
        const key = `${kind}:${repo}`;
        const hit = this._cache.get(key);
        if (hit && Date.now() - hit.at < LIST_CACHE_MS)
            return hit.list;
        const list = await fetch();
        this._cache.set(key, {at: Date.now(), list});
        return list;
    }

    async _pickAssignees(item) {
        const logins = await this._load(item, token => this._cachedList('assignees', item.repo,
            () => this._client.listAssignable(token, item.repo)));
        if (!logins)
            return;
        // You can always assign or unassign yourself; current assignees stay listed too.
        const me = this._getLogin();
        const all = [...new Set([...(me ? [me] : []), ...item.assignees, ...logins])];
        this._open(new PickerDialog({
            title: _('Assignees'),
            description: `#${item.number} ${item.title}`,
            options: all.map(login => ({id: login, label: login === me ? _('%s (you)').format(login) : login})),
            selected: item.assignees,
            emptyText: _('Nobody can be assigned in this repository.'),
            onApply: wanted => {
                const {add, remove} = diffSelection(item.assignees, wanted);
                const requests = [
                    add.length ? assigneesRequest(item, add, true) : null,
                    remove.length ? assigneesRequest(item, remove, false) : null,
                ].filter(Boolean);
                this._send(item, requests, _('Assignees updated'), 'updated');
            },
        }));
    }

    async _pickLabels(item) {
        const labels = await this._load(item, token => this._cachedList('labels', item.repo,
            () => this._client.listLabels(token, item.repo)));
        if (!labels)
            return;
        const current = item.labels.map(label => label.name);
        const names = [...new Set([...current, ...labels.map(label => label.name)])];
        this._open(new PickerDialog({
            title: _('Labels'),
            description: `#${item.number} ${item.title}`,
            options: names.map(name => ({id: name, label: name})),
            selected: current,
            emptyText: _('This repository has no labels.'),
            onApply: wanted => {
                const {add, remove} = diffSelection(current, wanted);
                const requests = [
                    add.length ? addLabelsRequest(item, add) : null,
                    ...remove.map(name => removeLabelRequest(item, name)),
                ].filter(Boolean);
                this._send(item, requests, _('Labels updated'), 'updated');
            },
        }));
    }

    /** Fetches data a dialog needs, with the item marked busy. Resolves to null on failure. */
    async _load(item, fetch) {
        this._setBusy(item, true);
        try {
            const token = await this._getToken();
            if (!token)
                throw new GitHubError({kind: 'auth', status: 401, retryAt: null});
            return await fetch(token);
        } catch (e) {
            if (!isCancelled(e))
                Main.notify(_('sourceglance'), actionErrorText(e));
            return null;
        } finally {
            this._setBusy(item, false);
        }
    }

    /** Sends requests in order and stops at the first failure. */
    async _send(item, requests, doneText, change) {
        if (requests.length === 0)
            return;
        this._setBusy(item, true);
        try {
            const token = await this._getToken();
            if (!token)
                throw new GitHubError({kind: 'auth', status: 401, retryAt: null});
            for (const request of requests)
                await this._client.send(token, request);
            Main.notify(_('sourceglance'), _('%s: #%d %s').format(doneText, item.number, item.title));
            this._onChanged(item, change);
        } catch (e) {
            if (!isCancelled(e)) {
                Main.notify(_('sourceglance'), actionErrorText(e));
                // Part of a multi-request change may have landed; show what GitHub has now.
                this._onChanged(item, 'updated');
            }
        } finally {
            this._setBusy(item, false);
        }
    }
}
