// Actions on issues, PRs and project items in the window: Adw dialogs, then the same requests
// the top-bar menus send (model.js builders). Results show as toasts.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {GitHubError, isCancelled} from '../lib/github.js';
import {
    assigneeChangeRequests,
    assigneeChoices,
    closeRequest,
    commentRequest,
    isSafeGitHubUrl,
    itemKey,
    labelChangeRequests,
    labelChoices,
    moveStatusRequest,
    reopenRequest,
} from '../lib/model.js';

function itemText(item) {
    return item.kind === 'draft' ? item.title : `#${item.number} ${item.title}`;
}

function errorText(error) {
    if (!(error instanceof GitHubError))
        return _('Something went wrong: %s').format(error.message);
    switch (error.kind) {
    case 'auth':
        return _('Your sign-in was rejected. Sign in again under Accounts → GitHub.');
    case 'forbidden':
        return _('Your sign-in can’t change this.');
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

export class WindowActions {
    /** `data` is the WindowData; `window` parents the dialogs. */
    constructor({window, client, data, toast}) {
        this._window = window;
        this._client = client;
        this._data = data;
        this._toast = toast;
    }

    open(url) {
        if (isSafeGitHubUrl(url))
            new Gtk.UriLauncher({uri: url}).launch(this._window, null, null);
    }

    comment(item) {
        const view = new Gtk.TextView({wrap_mode: Gtk.WrapMode.WORD_CHAR, top_margin: 8, bottom_margin: 8,
            left_margin: 8, right_margin: 8});
        const dialog = new Adw.AlertDialog({
            heading: _('Comment'),
            body: itemText(item),
            extra_child: new Gtk.ScrolledWindow({child: view, min_content_height: 140, css_classes: ['card']}),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('post', _('Post comment'));
        dialog.set_response_appearance('post', Adw.ResponseAppearance.SUGGESTED);
        dialog.set_response_enabled('post', false);
        view.buffer.connect('changed', () =>
            dialog.set_response_enabled('post', view.buffer.text.trim().length > 0));
        dialog.connect('response', (_dialog, response) => {
            if (response === 'post')
                this._send(item, [commentRequest(item, view.buffer.text)], _('Comment posted'));
        });
        dialog.present(this._window);
    }

    close(item) {
        const dialog = new Adw.AlertDialog({
            heading: item.kind === 'pr' ? _('Close pull request #%d?').format(item.number)
                : _('Close issue #%d?').format(item.number),
            body: `${item.title}\n${item.repo}`,
        });
        dialog.add_response('cancel', _('Cancel'));
        if (item.kind === 'pr') {
            dialog.add_response('pr', _('Close pull request'));
            dialog.set_response_appearance('pr', Adw.ResponseAppearance.DESTRUCTIVE);
        } else {
            dialog.add_response('not_planned', _('Not planned'));
            dialog.add_response('completed', _('Completed'));
            dialog.set_response_appearance('completed', Adw.ResponseAppearance.SUGGESTED);
        }
        dialog.connect('response', (_dialog, response) => {
            if (response !== 'cancel')
                this._send(item, [closeRequest(item, response)], _('Closed'));
        });
        dialog.present(this._window);
    }

    reopen(item) {
        this._send(item, [reopenRequest(item)], _('Reopened'));
    }

    async assignees(item) {
        const logins = await this._fetch(item, token => this._client.listAssignable(token, item.repo));
        if (!logins)
            return;
        const me = this._data.state.login;
        this._pick({
            heading: _('Assignees'),
            item,
            options: assigneeChoices(item, me, logins).map(login => ({id: login, label: login === me ? _('%s (you)').format(login) : login})),
            selected: item.assignees,
            empty: _('Nobody can be assigned in this repository.'),
            onApply: wanted => this._send(item, assigneeChangeRequests(item, wanted), _('Assignees updated')),
        });
    }

    async labels(item) {
        const labels = await this._fetch(item, token => this._client.listLabels(token, item.repo));
        if (!labels)
            return;
        this._pick({
            heading: _('Labels'),
            item,
            options: labelChoices(item, labels).map(name => ({id: name, label: name})),
            selected: item.labels.map(label => label.name),
            empty: _('This repository has no labels.'),
            onApply: wanted => this._send(item, labelChangeRequests(item, wanted), _('Labels updated')),
        });
    }

    status(item, board) {
        this._pick({
            heading: _('Move on %s').format(board.title),
            item,
            options: board.options.map(option => ({id: option.id, label: option.name})),
            selected: board.optionId ? [board.optionId] : [],
            single: true,
            empty: _('This board’s Status field has no options.'),
            onApply: ([optionId]) => {
                if (!optionId || optionId === board.optionId)
                    return;
                const name = board.options.find(option => option.id === optionId)?.name ?? '';
                this._send(item, [moveStatusRequest(board, optionId)], _('Moved to %s').format(name));
            },
        });
    }

    /** A check-list (or single-choice) dialog. */
    _pick({heading, item, options, selected, single = false, empty, onApply}) {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4, margin_top: 6, margin_bottom: 6});
        const checks = [];
        let group = null;
        for (const option of options) {
            const check = new Gtk.CheckButton({label: option.label, active: selected.includes(option.id)});
            if (single) {
                if (group)
                    check.set_group(group);
                group ??= check;
            }
            checks.push({id: option.id, check});
            box.append(check);
        }
        if (options.length === 0)
            box.append(new Gtk.Label({label: empty, css_classes: ['dim-label']}));
        const dialog = new Adw.AlertDialog({
            heading,
            body: itemText(item),
            extra_child: new Gtk.ScrolledWindow({child: box, min_content_height: Math.min(260, 32 * options.length + 12),
                hscrollbar_policy: Gtk.PolicyType.NEVER}),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('apply', _('Apply'));
        dialog.set_response_appearance('apply', Adw.ResponseAppearance.SUGGESTED);
        dialog.set_response_enabled('apply', options.length > 0);
        dialog.connect('response', (_dialog, response) => {
            if (response === 'apply')
                onApply(checks.filter(entry => entry.check.active).map(entry => entry.id));
        });
        dialog.present(this._window);
    }

    async _fetch(item, fetch) {
        this._data.setBusy(itemKey(item), true);
        try {
            const token = await this._data.token();
            if (!token)
                throw new GitHubError({kind: 'auth', status: 401, retryAt: null});
            return await fetch(token);
        } catch (e) {
            if (!isCancelled(e))
                this._toast(errorText(e));
            return null;
        } finally {
            this._data.setBusy(itemKey(item), false);
        }
    }

    /** Sends requests in order, stops at the first failure, then reloads (and nudges the top bar). */
    async _send(item, requests, doneText) {
        if (requests.length === 0)
            return;
        this._data.setBusy(itemKey(item), true);
        try {
            const token = await this._data.token();
            if (!token)
                throw new GitHubError({kind: 'auth', status: 401, retryAt: null});
            for (const request of requests)
                await this._client.send(token, request);
            this._toast(`${doneText}: ${itemText(item)}`);
        } catch (e) {
            if (!isCancelled(e))
                this._toast(errorText(e));
        } finally {
            this._data.setBusy(itemKey(item), false);
            this._data.refreshAfterChange();
        }
    }
}
