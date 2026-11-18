// Actions on issues, PRs and project items in the window: Adw dialogs, then the same requests
// the top-bar menus send (model.js builders), as the account the item came from. Results
// show as toasts.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {gettext as _, ngettext} from './i18n.js';

import {accountForItem, hostLabel, isDefaultBase} from '../lib/accounts.js';
import {GitHubError, isCancelled} from '../lib/github.js';
import {applyFormat} from '../lib/markdown.js';
import {assigneeChoices, itemKey, itemRef, labelChoices, moveStatusRequest, relativeTime} from '../lib/model.js';
import {
    assigneeRequests,
    bodyRequests,
    closeReasons,
    closeRequests,
    commentRequests,
    isSafeLink,
    labelRequests,
    previewRequests,
    reopenRequests,
} from '../lib/requests.js';
import {addChip, chip, chipLine, labelClass} from './pages/common.js';

/** Text from GitHub or GitLab, shown as is (never as markup), selectable. */
function plainText(text, dim = false) {
    return new Gtk.Label({label: text, use_markup: false, wrap: true, wrap_mode: 2 /* WORD_CHAR */, xalign: 0,
        selectable: true, css_classes: dim ? ['dim-label'] : []});
}

/** Read-only reactions: an emoji and its count each. */
function reactionLine(reactions) {
    const line = new Gtk.Box({spacing: 6});
    for (const {emoji, count} of reactions) {
        const label = new Gtk.Label({label: `${emoji} ${count}`, css_classes: ['sourceglance-reaction']});
        line.append(label);
    }
    return line;
}

function formatAgo(date) {
    if (Number.isNaN(date.getTime()))
        return '';
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

function errorText(error, item = null) {
    if (!(error instanceof GitHubError))
        return _('Something went wrong: %s').format(error.message);
    switch (error.kind) {
    case 'auth':
        return _('Your sign-in was rejected. Sign in again under Settings → Accounts.');
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

export class WindowActions {
    /** `data` is the WindowData; `clients` an AccountClients; `window` parents the dialogs. */
    /** `panel` is {show({title, subtitle, child, owner}), hide(), isFor(owner)}: the window's right panel. */
    constructor({window, clients, data, toast, icons, panel}) {
        this._window = window;
        this._panel = panel;
        this._icons = icons;
        // Items whose labels and assignees are showing (collapsed by default), by itemKey().
        this._expanded = new Set();
        this._clients = clients;
        this._data = data;
        this._toast = toast;
    }

    /** The item's account, its client and token; throws a sign-in error when it's gone. */
    async _session(item) {
        const account = this._data.account(accountForItem(item));
        const token = account ? await this._clients.tokenFor(account) : null;
        if (!token)
            throw new GitHubError({kind: account ? 'auth' : 'signed-out', status: 401, retryAt: null});
        return {client: this._clients.clientFor(account), token};
    }

    /** "Open on GitHub", or the instance's address for a self-hosted one. */
    openLabel(item) {
        const account = this._data.account(accountForItem(item));
        if (account && !isDefaultBase(account.platform, account.base))
            return _('Open on %s').format(hostLabel(account.base));
        return item.platform === 'gitlab' ? _('Open on GitLab') : _('Open on GitHub');
    }

    open(url) {
        if (isSafeLink(url))
            new Gtk.UriLauncher({uri: url}).launch(this._window, null, null);
    }

    /**
     * A small Markdown editor: a formatting toolbar over the text, with Ctrl+B, Ctrl+I and
     * Ctrl+Enter (runs `onSubmit`). Returns {widget, buffer, view}.
     */
    _editor({text = '', minHeight = 180, onSubmit}) {
        const view = new Gtk.TextView({wrap_mode: Gtk.WrapMode.WORD_CHAR, monospace: true, top_margin: 10,
            bottom_margin: 10, left_margin: 12, right_margin: 12, accepts_tab: false});
        const buffer = view.buffer;
        buffer.text = text;
        const format = name => {
            const [selected, from, to] = buffer.get_selection_bounds();
            const start = selected ? from.get_offset() : buffer.cursor_position;
            const end = selected ? to.get_offset() : start;
            const result = applyFormat(buffer.text, start, end, name);
            buffer.begin_user_action();
            buffer.text = result.text;
            buffer.end_user_action();
            // Keep a selection selected; with none, the cursor goes after the new marks.
            const caret = selected || result.start === result.end ? result.start : result.end;
            buffer.select_range(buffer.get_iter_at_offset(selected ? result.end : caret),
                buffer.get_iter_at_offset(caret));
            view.grab_focus();
        };

        const toolbar = new Gtk.Box({spacing: 2, margin_start: 6, margin_end: 6, margin_top: 4, margin_bottom: 4});
        const tools = [
            ['bold', 'format-text-bold-symbolic', _('Bold (Ctrl+B)')],
            ['italic', 'format-text-italic-symbolic', _('Italic (Ctrl+I)')],
            ['strike', 'format-text-strikethrough-symbolic', _('Strikethrough')],
            ['code', this._icons.code, _('Inline code')],
            null,
            ['bullet', 'view-list-bullet-symbolic', _('Bulleted list')],
            ['number', 'view-list-ordered-symbolic', _('Numbered list')],
            ['quote', 'format-indent-more-symbolic', _('Quote')],
            ['codeBlock', 'utilities-terminal-symbolic', _('Code block')],
        ];
        for (const tool of tools) {
            if (!tool) {
                toolbar.append(new Gtk.Separator({orientation: Gtk.Orientation.VERTICAL, margin_start: 4, margin_end: 4}));
                continue;
            }
            const [name, icon, tooltip] = tool;
            const button = typeof icon === 'string'
                ? new Gtk.Button({icon_name: icon, tooltip_text: tooltip, css_classes: ['flat']})
                : new Gtk.Button({child: new Gtk.Image({gicon: icon}), tooltip_text: tooltip, css_classes: ['flat']});
            button.update_property([Gtk.AccessibleProperty.LABEL], [tooltip]);
            button.connect('clicked', () => format(name));
            toolbar.append(button);
        }

        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_controller, keyval, _code, state) => {
            if (!(state & Gdk.ModifierType.CONTROL_MASK))
                return false;
            if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter)
                onSubmit?.();
            else if (keyval === Gdk.KEY_b || keyval === Gdk.KEY_B)
                format('bold');
            else if (keyval === Gdk.KEY_i || keyval === Gdk.KEY_I)
                format('italic');
            else
                return false;
            return true;
        });
        view.add_controller(keys);

        const widget = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        widget.append(toolbar);
        widget.append(new Gtk.Separator());
        widget.append(new Gtk.ScrolledWindow({child: view, vexpand: true, min_content_height: minHeight,
            hscrollbar_policy: Gtk.PolicyType.NEVER}));
        return {widget, buffer, view};
    }

    /** The comment editor in a dialog, Post in the header. */
    comment(item) {
        let send = null;
        const editor = this._editor({onSubmit: () => send()});
        const post = new Gtk.Button({label: _('Post'), css_classes: ['suggested-action'], sensitive: false});
        const cancel = new Gtk.Button({label: _('Cancel')});
        const header = new Adw.HeaderBar({show_start_title_buttons: false, show_end_title_buttons: false,
            title_widget: new Adw.WindowTitle({title: _('Comment'), subtitle: itemText(item)})});
        header.pack_start(cancel);
        header.pack_end(post);

        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        content.append(editor.widget);
        content.append(new Gtk.Separator());
        content.append(new Gtk.Label({label: _('Markdown · Ctrl+Enter posts'), xalign: 0, margin_start: 12,
            margin_top: 6, margin_bottom: 6, css_classes: ['dim-label', 'caption']}));
        const toolbarView = new Adw.ToolbarView({content});
        toolbarView.add_top_bar(header);
        const dialog = new Adw.Dialog({child: toolbarView, content_width: 520, content_height: 360,
            title: _('Comment'), focus_widget: editor.view});

        const canPost = () => commentRequests(item, editor.buffer.text).length > 0;
        editor.buffer.connect('changed', () => {
            post.sensitive = canPost();
        });
        send = () => {
            if (!canPost())
                return;
            const text = editor.buffer.text;
            dialog.close();
            this._send(item, commentRequests(item, text), _('Comment posted'));
        };
        post.connect('clicked', send);
        cancel.connect('clicked', () => dialog.close());
        dialog.present(this._window);
    }

    /**
     * The preview, in the window's right panel: the description (editable), the comments and
     * reactions (read only), and a box to add a comment. Drafts show only their description.
     * Text stays plain.
     */
    preview(item) {
        const draft = item.kind === 'draft';
        const owner = itemKey(item);
        const show = child => this._panel.show({title: itemText(item), subtitle: draft ? '' : item.repo, child, owner});
        const load = async () => {
            show(new Gtk.Spinner({spinning: true, width_request: 32, height_request: 32,
                halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER}));
            const {requests, parse} = previewRequests(item);
            const details = await this._fetch(item, async ({client, token}) => {
                const responses = [];
                for (const request of requests)
                    responses.push(await client.send(token, request));
                return parse(responses);
            }, false);
            // Another item's preview may have replaced this one meanwhile, or it was closed.
            if (!this._panel.isFor(owner))
                return;
            if (!details) {
                this._panel.hide();
                return;
            }
            // The comments scroll; the box to add one stays at the bottom.
            const {content, composer} = this._previewContent(item, details, load);
            const panel = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
            panel.append(new Gtk.ScrolledWindow({child: content, hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true}));
            if (composer) {
                panel.append(new Gtk.Separator());
                panel.append(composer);
            }
            show(panel);
        };
        load();
    }

    /** The preview's scrolling part ({content}) and, except for drafts, the box to add a comment ({composer}). */
    _previewContent(item, details, reload) {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 14,
            margin_top: 14, margin_bottom: 14, margin_start: 14, margin_end: 14});

        // Description: shown, or the editor while editing.
        const heading = new Gtk.Box({spacing: 6});
        const by = details.author ? _('Description · opened by %s').format(details.author) : _('Description');
        heading.append(new Gtk.Label({label: by, xalign: 0, hexpand: true, css_classes: ['heading']}));
        const edit = new Gtk.Button({child: new Adw.ButtonContent({icon_name: 'document-edit-symbolic', label: _('Edit')}),
            css_classes: ['flat']});
        heading.append(edit);
        box.append(heading);
        const description = new Gtk.Stack({vhomogeneous: false, transition_type: Gtk.StackTransitionType.CROSSFADE});
        const shown = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8});
        shown.append(plainText(details.body || _('No description'), !details.body));
        if (details.reactions.length)
            shown.append(reactionLine(details.reactions));
        description.add_named(shown, 'shown');
        let save = null;
        const editor = this._editor({text: details.body, minHeight: 160, onSubmit: () => save()});
        const editing = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8});
        const frame = new Gtk.Frame({child: editor.widget});
        editing.append(frame);
        const editButtons = new Gtk.Box({spacing: 8, halign: Gtk.Align.END});
        const cancel = new Gtk.Button({label: _('Cancel')});
        const saveButton = new Gtk.Button({label: _('Save'), css_classes: ['suggested-action']});
        editButtons.append(cancel);
        editButtons.append(saveButton);
        editing.append(editButtons);
        description.add_named(editing, 'editing');
        edit.connect('clicked', () => {
            editor.buffer.text = details.body;
            description.visible_child_name = 'editing';
            edit.visible = false;
            editor.view.grab_focus();
        });
        cancel.connect('clicked', () => {
            description.visible_child_name = 'shown';
            edit.visible = true;
        });
        save = async () => {
            const requests = bodyRequests(item, editor.buffer.text);
            if (requests.length === 0)
                return;
            saveButton.sensitive = false;
            if (await this._send(item, requests, _('Description saved')))
                reload();
            else
                saveButton.sensitive = true;
        };
        saveButton.connect('clicked', save);
        box.append(description);

        if (item.kind === 'draft')
            return {content: new Adw.Clamp({child: box, maximum_size: 720}), composer: null};

        // Comments, oldest first, then the box to add one.
        const count = details.comments.length + details.more;
        box.append(new Gtk.Label({label: ngettext('%d comment', '%d comments', count).format(count), xalign: 0,
            css_classes: ['heading']}));
        for (const comment of details.comments) {
            const card = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, css_classes: ['card'],
                margin_bottom: 2});
            const inner = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6,
                margin_top: 10, margin_bottom: 10, margin_start: 12, margin_end: 12});
            const when = comment.createdAt ? formatAgo(new Date(comment.createdAt)) : '';
            inner.append(new Gtk.Label({label: [comment.author ?? _('Someone'), when].filter(Boolean).join(' · '),
                xalign: 0, css_classes: ['dim-label', 'caption']}));
            inner.append(plainText(comment.body));
            if (comment.reactions.length)
                inner.append(reactionLine(comment.reactions));
            card.append(inner);
            box.append(card);
        }
        if (details.more > 0 && item.url) {
            const more = new Gtk.Button({label: ngettext('%d more comment in the browser', '%d more comments in the browser',
                details.more).format(details.more), css_classes: ['flat'], halign: Gtk.Align.START});
            more.connect('clicked', () => this.open(item.url));
            box.append(more);
        }
        let post = null;
        const composer = this._editor({minHeight: 72, onSubmit: () => post()});
        const footer = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8,
            margin_top: 10, margin_bottom: 10, margin_start: 10, margin_end: 10});
        footer.append(new Gtk.Frame({child: composer.widget}));
        const postButton = new Gtk.Button({label: _('Comment'), css_classes: ['suggested-action'], halign: Gtk.Align.END,
            sensitive: false, tooltip_text: _('Ctrl+Enter')});
        composer.buffer.connect('changed', () => {
            postButton.sensitive = commentRequests(item, composer.buffer.text).length > 0;
        });
        post = async () => {
            const requests = commentRequests(item, composer.buffer.text);
            if (requests.length === 0)
                return;
            postButton.sensitive = false;
            if (await this._send(item, requests, _('Comment posted')))
                reload();
            else
                postButton.sensitive = true;
        };
        postButton.connect('clicked', post);
        footer.append(postButton);
        return {content: new Adw.Clamp({child: box, maximum_size: 720}), composer: footer};
    }

    close(item) {
        const ref = itemRef(item);
        const gitlab = item.platform === 'gitlab';
        const heading = item.kind !== 'pr' ? _('Close issue %s?').format(ref)
            : gitlab ? _('Close merge request %s?').format(ref) : _('Close pull request %s?').format(ref);
        const dialog = new Adw.AlertDialog({heading, body: `${item.title}\n${item.repo}`});
        dialog.add_response('cancel', _('Cancel'));
        // GitHub issues: completed or not planned. Everything else just closes.
        const labels = {not_planned: _('Not planned'), completed: _('Completed'), close: _('Close')};
        for (const reason of closeReasons(item))
            dialog.add_response(reason, labels[reason]);
        dialog.set_response_appearance(closeReasons(item).at(-1), item.kind === 'pr'
            ? Adw.ResponseAppearance.DESTRUCTIVE : Adw.ResponseAppearance.SUGGESTED);
        dialog.connect('response', (_dialog, response) => {
            if (response !== 'cancel')
                this._send(item, closeRequests(item, response), _('Closed'));
        });
        dialog.present(this._window);
    }

    reopen(item) {
        this._send(item, reopenRequests(item), _('Reopened'));
    }

    async assignees(item) {
        // GitLab assigns by user id, so keep its members ({id, username}) for the request.
        const gitlab = item.platform === 'gitlab';
        const members = await this._fetch(item, ({client, token}) => gitlab
            ? client.listMembers(token, item.projectId)
            : client.listAssignable(token, item.repo).then(names => names.map(username => ({username}))));
        if (!members)
            return;
        const logins = members.map(member => member.username);
        const me = this._me(item);
        this._pick({
            heading: _('Assignees'),
            item,
            options: assigneeChoices(item, me, logins).map(login => ({id: login, label: login === me ? _('%s (you)').format(login) : login})),
            selected: item.assignees,
            empty: _('Nobody can be assigned in this repository.'),
            onApply: wanted => this._send(item, assigneeRequests(item, wanted, members), _('Assignees updated')),
        });
    }

    async labels(item) {
        const labels = await this._fetch(item, ({client, token}) => item.platform === 'gitlab'
            ? client.listLabels(token, item.projectId)
            : client.listLabels(token, item.repo));
        if (!labels)
            return;
        this._pick({
            heading: _('Labels'),
            item,
            options: labelChoices(item, labels).map(name => ({id: name, label: name})),
            selected: item.labels.map(label => label.name),
            empty: _('This repository has no labels.'),
            onApply: wanted => this._send(item, labelRequests(item, wanted), _('Labels updated')),
        });
    }

    isExpanded(item) {
        return this._expanded.has(itemKey(item));
    }

    setExpanded(item, open) {
        if (open)
            this._expanded.add(itemKey(item));
        else
            this._expanded.delete(itemKey(item));
    }

    /** The item's labels as coloured chips, with (x) to remove and (+) to add. */
    labelLine(item) {
        const chips = item.labels.map(label => chip({
            text: label.name, color: label.color, removeTooltip: _('Remove label %s').format(label.name),
            onRemove: () => this._send(item, labelRequests(item, item.labels.map(l => l.name).filter(n => n !== label.name)),
                _('Label removed')),
        }));
        chips.push(addChip({label: _('Label'), tooltip: _('Add a label'), onClick: anchor => this._addLabel(item, anchor)}));
        return chipLine({gicon: this._icons.label, name: _('Labels'), chips});
    }

    /** The item's assignees as chips, with (x) to unassign and (+) to assign. */
    assigneeLine(item) {
        const me = this._me(item);
        const chips = item.assignees.map(login => chip({
            text: login === me ? _('%s (you)').format(login) : login,
            removeTooltip: _('Unassign %s').format(login),
            onRemove: () => this._setAssignees(item, item.assignees.filter(other => other !== login), _('Unassigned')),
        }));
        chips.push(addChip({label: _('Assignee'), tooltip: _('Assign someone'), onClick: anchor => this._addAssignee(item, anchor)}));
        return chipLine({iconName: 'system-users-symbolic', name: _('Assignees'), chips});
    }

    /** Your login on the account the item came from. */
    _me(item) {
        return this._data.account(accountForItem(item))?.login ??
            this._data.state.sources.find(src => src.account.id === accountForItem(item))?.login ?? null;
    }

    /**
     * People who can be assigned: drafts carry theirs; issues and PRs ask their repository.
     * `busy` false leaves the row as it is, e.g. while a popover is anchored in it.
     */
    async _members(item, busy = true) {
        if (item.kind === 'draft')
            return item.people.map(user => ({username: user.login}));
        return this._fetch(item, ({client, token}) => item.platform === 'gitlab'
            ? client.listMembers(token, item.projectId)
            : client.listAssignable(token, item.repo).then(names => names.map(username => ({username}))), busy);
    }

    async _setAssignees(item, wanted, doneText) {
        // GitLab assigns by id, so it needs the members even to unassign.
        const members = item.platform === 'gitlab' ? await this._members(item) : [];
        if (members)
            this._send(item, assigneeRequests(item, wanted, members), doneText);
    }

    _addAssignee(item, anchor) {
        let members = [];
        this._popoverPick({
            anchor,
            load: async () => {
                members = await this._members(item, false);
                if (!members)
                    return null;
                const me = this._me(item);
                return assigneeChoices(item, me, members.map(member => member.username))
                    .filter(login => !item.assignees.includes(login))
                    .map(login => ({id: login, label: login === me ? _('%s (you)').format(login) : login}));
            },
            placeholder: _('Find a person'),
            empty: _('Nobody else can be assigned here.'),
            onPick: login => this._send(item, assigneeRequests(item, [...item.assignees, login], members), _('Assigned')),
        });
    }

    _addLabel(item, anchor) {
        const current = item.labels.map(label => label.name);
        this._popoverPick({
            anchor,
            load: async () => {
                const labels = await this._fetch(item, ({client, token}) => item.platform === 'gitlab'
                    ? client.listLabels(token, item.projectId)
                    : client.listLabels(token, item.repo), false);
                return labels?.filter(label => !current.includes(label.name))
                    .map(label => ({id: label.name, label: label.name, color: label.color})) ?? null;
            },
            placeholder: _('Find a label'),
            empty: _('No other labels in this repository.'),
            onPick: name => this._send(item, labelRequests(item, [...current, name]), _('Label added')),
        });
    }

    /**
     * A popover under `anchor`: a spinner while `load()` resolves to the options (null on
     * failure, which closes it), then the list with a filter box; picking one runs onPick(id).
     * The list can rebuild under it (a refresh), so it closes when its anchor goes away.
     */
    _popoverPick({anchor, load, placeholder, empty, onPick}) {
        if (!anchor.get_root())
            return;
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
        box.append(new Gtk.Spinner({spinning: true, width_request: 220, height_request: 48}));
        const popover = new Gtk.Popover({child: box});
        popover.set_parent(anchor);
        const unrealizeId = anchor.connect('unrealize', () => popover.popdown());
        popover.connect('closed', () => {
            anchor.disconnect(unrealizeId);
            if (popover.get_parent())
                popover.unparent();
        });
        popover.popup();

        load().then(options => {
            if (!popover.get_parent() || !popover.visible)
                return;
            if (!options) {
                popover.popdown();
                return;
            }
            box.remove(box.get_first_child());
            this._fillPick({popover, box, options, placeholder, empty, onPick});
        });
    }

    _fillPick({popover, box, options, placeholder, empty, onPick}) {
        const entry = new Gtk.SearchEntry({placeholder_text: placeholder});
        const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['navigation-sidebar']});
        for (const option of options) {
            const line = new Gtk.Box({spacing: 8, margin_top: 2, margin_bottom: 2});
            if (option.color !== undefined) {
                const color = option.color ? labelClass(option.color) : null;
                line.append(new Gtk.Box({css_classes: ['sourceglance-label-dot', ...color ? [color] : []],
                    valign: Gtk.Align.CENTER}));
            }
            line.append(new Gtk.Label({label: option.label, xalign: 0, ellipsize: 3 /* END */, max_width_chars: 32}));
            const row = new Gtk.ListBoxRow({child: line});
            row._option = option;
            list.append(row);
        }
        const matches = row => row._option.label.toLowerCase().includes(entry.text.trim().toLowerCase());
        list.set_filter_func(matches);
        entry.connect('search-changed', () => list.invalidate_filter());
        entry.connect('activate', () => {
            const first = options.map((_option, i) => list.get_row_at_index(i)).find(row => row && matches(row));
            if (first)
                list.emit('row-activated', first);
        });
        list.connect('row-activated', (_list, row) => {
            popover.popdown();
            onPick(row._option.id);
        });
        if (options.length > 8)
            box.append(entry);
        if (options.length === 0) {
            box.append(new Gtk.Label({label: empty, css_classes: ['dim-label'], margin_top: 6, margin_bottom: 6,
                margin_start: 6, margin_end: 6}));
        } else {
            box.append(new Gtk.ScrolledWindow({child: list, hscrollbar_policy: Gtk.PolicyType.NEVER,
                propagate_natural_height: true, max_content_height: 300, min_content_width: 220}));
        }
        if (options.length > 8)
            entry.grab_focus();
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

    /** `busy` false skips marking the item busy, which rebuilds its row. */
    async _fetch(item, fetch, busy = true) {
        if (busy)
            this._data.setBusy(itemKey(item), true);
        try {
            return await fetch(await this._session(item));
        } catch (e) {
            if (!isCancelled(e))
                this._toast(errorText(e, item));
            return null;
        } finally {
            if (busy)
                this._data.setBusy(itemKey(item), false);
        }
    }

    /**
     * Sends requests in order, stops at the first failure, then reloads (and nudges the top bar).
     * Resolves to whether all of them went through.
     */
    async _send(item, requests, doneText) {
        if (requests.length === 0)
            return false;
        this._data.setBusy(itemKey(item), true);
        try {
            const {client, token} = await this._session(item);
            for (const request of requests)
                await client.send(token, request);
            this._toast(`${doneText}: ${itemText(item)}`);
            return true;
        } catch (e) {
            if (!isCancelled(e))
                this._toast(errorText(e, item));
            return false;
        } finally {
            this._data.setBusy(itemKey(item), false);
            this._data.refreshAfterChange();
        }
    }
}
