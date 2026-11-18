// Runs menu actions: opens the dialog, sends the requests, reports the outcome.
// Every write starts from a user click; closing also needs a confirmation.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {CloseDialog, CommentDialog, PickerDialog} from './dialogs.js';
import {GitHubError, isCancelled} from './github.js';
import {
    assigneeChoices,
    itemRef,
    labelChoices,
    moveStatusRequest,
} from './model.js';
import {accountForItem} from './accounts.js';
import {assigneeRequests, closeRequests, commentRequests, labelRequests, reopenRequests} from './requests.js';

// Repository labels and assignable users change rarely; refetch after this long.
const LIST_CACHE_MS = 5 * 60 * 1000;

// "#12 Title" for issues and PRs; project drafts have no number.
function itemText(item) {
    return item.kind === 'draft' ? item.title : `${itemRef(item)} ${item.title}`;
}

/**
 * A refused change. On GitHub that usually means the sourceglance app isn't installed on the
 * repository: it can read public repositories without that, but not change them.
 */
function forbiddenText(item) {
    if (item?.platform === 'gitlab')
        return _('Your GitLab account can’t change this in %s.').format(item.repo);
    if (item?.repo) {
        return _('Source Glance can’t change %s: the Source Glance app isn’t installed there, or you don’t have permission. Make the change on GitHub, or ask the owner to install the app.')
            .format(item.repo);
    }
    return _('Your sign-in can’t change this.');
}

function actionErrorText(error, item = null) {
    if (!(error instanceof GitHubError))
        return _('Something went wrong: %s').format(error.message);
    switch (error.kind) {
    case 'auth':
        return _('Your sign-in was rejected. Sign in again in Settings.');
    case 'signed-out':
        return _('The account this came from is no longer signed in.');
    case 'insecure':
        return _('This instance uses plain http:// and isn’t on your local network now, so Source Glance won’t send your sign-in to it.');
    case 'forbidden':
        return forbiddenText(item);
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
     * Every change runs as the account the item came from (item.accountId).
     *
     * @param {object} params
     * @param {AccountClients} params.clients a client and token per account (accountStore.js)
     * @param {(id: string) => object|null} params.getAccount the account with that id
     * @param {(id: string) => string|null} params.getLogin that account's login
     * @param {(item, busy: boolean) => void} params.setBusy
     * @param {(item, change: 'closed'|'reopened'|'updated') => void} params.onChanged
     */
    constructor({clients, getAccount, getLogin, setBusy, onChanged}) {
        this._clients = clients;
        this._getAccount = getAccount;
        this._getLogin = getLogin;
        this._setBusy = setBusy;
        this._onChanged = onChanged;
        this._dialog = null;
        this._cache = new Map();
    }

    /** Closes any open action dialog (on Quit). */
    closeDialog() {
        this._dialog?.close();
        this._dialog = null;
    }

    destroy() {
        this._dialog?.close();
        this._dialog = null;
        this._cache.clear();
        this._clients = null;
    }

    /** The item's account, its client and token; throws a sign-in error when it's gone. */
    async _session(item) {
        const account = this._getAccount(accountForItem(item));
        const token = account ? await this._clients.tokenFor(account) : null;
        if (!token)
            throw new GitHubError({kind: account ? 'auth' : 'signed-out', status: 401, retryAt: null});
        return {account, client: this._clients.clientFor(account), token};
    }

    /** `arg` is the project board for 'status'. */
    run(item, action, arg = null) {
        switch (action) {
        case 'comment':
            this._open(new CommentDialog(item, text =>
                this._send(item, commentRequests(item, text), _('Comment posted'), 'updated')));
            break;
        case 'close':
            this._open(new CloseDialog(item, reason =>
                this._send(item, closeRequests(item, reason), _('Closed'), 'closed')));
            break;
        case 'reopen':
            this._send(item, reopenRequests(item), _('Reopened'), 'reopened');
            break;
        case 'assignees':
            this._pickAssignees(item);
            break;
        case 'labels':
            this._pickLabels(item);
            break;
        case 'status':
            this._pickStatus(item, arg);
            break;
        }
    }

    _pickStatus(item, board) {
        this._open(new PickerDialog({
            title: _('Move on %s').format(board.title),
            description: itemText(item),
            options: board.options.map(option => ({id: option.id, label: option.name})),
            selected: board.optionId ? [board.optionId] : [],
            single: true,
            emptyText: _('This board’s Status field has no options.'),
            onApply: ([optionId]) => {
                if (!optionId || optionId === board.optionId)
                    return;
                const name = board.options.find(option => option.id === optionId)?.name ?? '';
                this._send(item, [moveStatusRequest(board, optionId)],
                    _('Moved to %s').format(name), 'updated');
            },
        }));
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

    async _cachedList(kind, item, fetch) {
        const key = `${accountForItem(item)}\n${kind}:${item.repo}`;
        const hit = this._cache.get(key);
        if (hit && Date.now() - hit.at < LIST_CACHE_MS)
            return hit.list;
        const list = await fetch();
        this._cache.set(key, {at: Date.now(), list});
        return list;
    }

    async _pickAssignees(item) {
        // GitLab assigns by user id, so keep its members ({id, username}) for the request.
        const gitlab = item.platform === 'gitlab';
        const members = await this._load(item, ({client, token}) => this._cachedList('assignees', item,
            () => gitlab
                ? client.listMembers(token, item.projectId)
                : client.listAssignable(token, item.repo).then(logins => logins.map(username => ({username})))));
        if (!members)
            return;
        const me = this._getLogin(accountForItem(item));
        const all = assigneeChoices(item, me, members.map(member => member.username));
        this._open(new PickerDialog({
            title: _('Assignees'),
            description: itemText(item),
            options: all.map(login => ({id: login, label: login === me ? _('%s (you)').format(login) : login})),
            selected: item.assignees,
            emptyText: _('Nobody can be assigned in this repository.'),
            onApply: wanted => this._send(item, assigneeRequests(item, wanted, members), _('Assignees updated'), 'updated'),
        }));
    }

    async _pickLabels(item) {
        const labels = await this._load(item, ({client, token}) => this._cachedList('labels', item,
            () => item.platform === 'gitlab'
                ? client.listLabels(token, item.projectId)
                : client.listLabels(token, item.repo)));
        if (!labels)
            return;
        const current = item.labels.map(label => label.name);
        const names = labelChoices(item, labels);
        this._open(new PickerDialog({
            title: _('Labels'),
            description: itemText(item),
            options: names.map(name => ({id: name, label: name})),
            selected: current,
            emptyText: _('This repository has no labels.'),
            onApply: wanted => this._send(item, labelRequests(item, wanted), _('Labels updated'), 'updated'),
        }));
    }

    /** Fetches data a dialog needs, with the item marked busy. Resolves to null on failure. */
    async _load(item, fetch) {
        this._setBusy(item, true);
        try {
            return await fetch(await this._session(item));
        } catch (e) {
            if (!isCancelled(e))
                Main.notify(_('Source Glance'), actionErrorText(e, item));
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
            const {client, token} = await this._session(item);
            for (const request of requests)
                await client.send(token, request);
            Main.notify(_('Source Glance'), _('%s: %s').format(doneText, itemText(item)));
            this._onChanged(item, change);
        } catch (e) {
            if (!isCancelled(e)) {
                Main.notify(_('Source Glance'), actionErrorText(e, item));
                // Part of a multi-request change may have landed; show what's there now.
                this._onChanged(item, 'updated');
            }
        } finally {
            this._setBusy(item, false);
        }
    }
}
