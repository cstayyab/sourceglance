// Accounts (from the title bar): every signed-in account, adding one (github.com, gitlab.com, or a
// self-hosted instance through the wizard in addAccount.js), and the GitHub repository filter.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {loadAccounts, removeAccount} from '../../lib/accountStore.js';
import {GITHUB_COM, GITLAB_COM, accountTitle, hostLabel, isDefaultBase} from '../../lib/accounts.js';
import {GitHubError, isCancelled} from '../../lib/github.js';
import {openAddAccountDialog} from './addAccount.js';
import {buildGithubGroups} from './github.js';

function methodText(account) {
    return account.method === 'pat' ? _('Personal access token') : _('Browser sign-in');
}

function checkErrorText(error) {
    if (!(error instanceof GitHubError))
        return _('Couldn’t check the sign-in');
    switch (error.kind) {
    case 'auth':
        return _('Sign-in rejected: sign in again');
    case 'insecure':
        return _('Not on your local network now (plain http://)');
    case 'network':
        return _('Couldn’t reach the instance');
    default:
        return _('Couldn’t check the sign-in (HTTP %d)').format(error.status);
    }
}

/** `ctx` is {window, settings, clients, version, toast}. */
export function buildAccountsPage(ctx) {
    const {window, settings, clients, toast} = ctx;
    const page = new Adw.PreferencesPage();

    const list = new Adw.PreferencesGroup({
        title: _('Accounts'),
        description: _('Items from every account show in the lists, each account in its own section. Changes run as the account the item came from.'),
    });
    page.add(list);
    let rows = [];

    const confirmRemove = account => {
        const dialog = new Adw.AlertDialog({
            heading: _('Sign out of %s?').format(accountTitle(account)),
            body: _('Source Glance forgets this account’s sign-in from the keyring and stops showing its items. A personal access token stays valid until you revoke it on the instance.'),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('remove', _('Sign out'));
        dialog.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', async (_dialog, response) => {
            if (response !== 'remove')
                return;
            try {
                await removeAccount(settings, account);
                toast(_('Signed out of %s').format(accountTitle(account)));
            } catch (e) {
                toast(_('Couldn’t sign out: %s').format(e.message));
            }
        });
        dialog.present(window);
    };

    const accountRow = account => {
        const row = new Adw.ActionRow({
            title: accountTitle(account),
            subtitle: `${isDefaultBase(account.platform, account.base) ? '' : `${hostLabel(account.base)} · `}${methodText(account)} · ${_('Checking…')}`,
            use_markup: false,
        });
        row.add_prefix(new Gtk.Image({icon_name: 'avatar-default-symbolic'}));
        const again = new Gtk.Button({label: _('Sign in again'), valign: Gtk.Align.CENTER, visible: false});
        again.connect('clicked', () => openAddAccountDialog(ctx, {platform: account.platform, base: account.base}));
        const remove = new Gtk.Button({icon_name: 'user-trash-symbolic', tooltip_text: _('Sign out'),
            valign: Gtk.Align.CENTER, css_classes: ['flat']});
        remove.connect('clicked', () => confirmRemove(account));
        row.add_suffix(again);
        row.add_suffix(remove);
        const prefix = row.subtitle.slice(0, row.subtitle.lastIndexOf(' · '));
        (async () => {
            try {
                const token = await clients.tokenFor(account);
                if (!token) {
                    row.subtitle = `${prefix} · ${_('Not signed in')}`;
                    again.visible = true;
                    return;
                }
                await clients.clientFor(account).getViewer(token);
                row.subtitle = `${prefix} · ${_('Signed in')}`;
            } catch (e) {
                if (isCancelled(e))
                    return;
                row.subtitle = `${prefix} · ${checkErrorText(e)}`;
                again.visible = e instanceof GitHubError && e.kind === 'auth';
            }
        })();
        return row;
    };

    const rebuild = async () => {
        let accounts;
        try {
            accounts = await loadAccounts(settings);
        } catch (e) {
            console.warn(`sourceglance: couldn’t read the accounts: ${e.message}`);
            accounts = [];
        }
        for (const row of rows)
            list.remove(row);
        rows = accounts.length ? accounts.map(accountRow)
            : [new Adw.ActionRow({title: _('No accounts yet. Add one below.'), css_classes: ['dim-label']})];
        for (const row of rows)
            list.add(row);
    };
    const changedId = settings.connect('changed::accounts', () => rebuild());
    window.connect('close-request', () => {
        settings.disconnect(changedId);
        return false;
    });
    rebuild();

    const add = new Adw.PreferencesGroup({
        title: _('Add an account'),
        description: _('You can add several accounts of each, for example a personal and a work account.'),
    });
    const addRow = (title, subtitle, options) => {
        const row = new Adw.ActionRow({title, subtitle, activatable: true});
        row.add_suffix(new Gtk.Image({icon_name: 'list-add-symbolic'}));
        row.connect('activated', () => openAddAccountDialog(ctx, options));
        add.add(row);
    };
    addRow('GitHub', 'github.com', {platform: 'github', base: GITHUB_COM});
    addRow('GitLab', 'gitlab.com', {platform: 'gitlab', base: GITLAB_COM});
    addRow(_('Connect a self-hosted instance'), _('GitLab self-managed or GitHub Enterprise Server'), {});
    page.add(add);

    for (const group of buildGithubGroups(ctx))
        page.add(group);
    return page;
}
