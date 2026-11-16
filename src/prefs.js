import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {GitHubClient, GitHubError} from './lib/github.js';
import {parseRepoList} from './lib/model.js';
import {clearToken, lookupToken, storeToken} from './lib/tokenStore.js';

const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

function describeError(error) {
    if (!(error instanceof GitHubError))
        return _('Something went wrong: %s').format(error.message);
    switch (error.kind) {
    case 'auth':
        return _('GitHub rejected this token.');
    case 'forbidden':
        return _('This token doesn’t have the required permissions.');
    case 'rate-limit':
        return _('GitHub rate limit reached. Try again later.');
    case 'network':
        return _('Couldn’t reach GitHub. Check your connection.');
    default:
        return _('GitHub returned an error (HTTP %d).').format(error.status);
    }
}

export default class SourceglancePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const client = new GitHubClient(this.metadata['version-name'] ?? 'dev');
        window.connect('close-request', () => {
            client.destroy();
            return false;
        });

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        page.add(this._buildAccountGroup(window, settings, client));
        page.add(this._buildIssuesGroup(settings));
    }

    _buildAccountGroup(window, settings, client) {
        const group = new Adw.PreferencesGroup({title: _('Account')});

        const statusRow = new Adw.ActionRow({title: _('Status'), subtitle: _('Checking…')});
        const signOutButton = new Gtk.Button({
            label: _('Sign out'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
            visible: false,
        });
        statusRow.add_suffix(signOutButton);
        group.add(statusRow);

        const tokenRow = new Adw.PasswordEntryRow({
            title: _('Personal access token'),
            show_apply_button: true,
        });
        group.add(tokenRow);

        const linkRow = new Adw.ActionRow({
            title: _('Create a token'),
            subtitle: _('Fine-grained token with read-only “Issues” and “Metadata” access'),
            activatable: true,
        });
        linkRow.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        linkRow.connect('activated', () => {
            new Gtk.UriLauncher({uri: NEW_TOKEN_URL}).launch(window, null, null);
        });
        group.add(linkRow);

        const setLogin = login => {
            statusRow.subtitle = login ? _('Signed in as @%s').format(login) : _('Not signed in');
            signOutButton.visible = Boolean(login);
        };
        const toast = title => window.add_toast(new Adw.Toast({title}));
        // Tells the running extension to re-read the keyring right away.
        const notifyTokenChanged = () =>
            settings.set_int('token-changed', settings.get_int('token-changed') + 1);

        tokenRow.connect('apply', async () => {
            const token = tokenRow.get_text().trim();
            if (!token)
                return;
            tokenRow.sensitive = false;
            try {
                const login = await client.getViewer(token);
                await storeToken(token);
                tokenRow.set_text('');
                setLogin(login);
                notifyTokenChanged();
                toast(_('Signed in as @%s').format(login));
            } catch (e) {
                toast(describeError(e));
            } finally {
                tokenRow.sensitive = true;
            }
        });

        signOutButton.connect('clicked', async () => {
            try {
                await clearToken();
                setLogin(null);
                notifyTokenChanged();
                toast(_('Signed out'));
            } catch (e) {
                toast(describeError(e));
            }
        });

        (async () => {
            try {
                const token = await lookupToken();
                setLogin(token ? await client.getViewer(token) : null);
            } catch (e) {
                statusRow.subtitle = describeError(e);
                signOutButton.visible = true;
            }
        })();

        return group;
    }

    _buildIssuesGroup(settings) {
        const group = new Adw.PreferencesGroup({title: _('Issues')});

        const reposRow = new Adw.EntryRow({
            title: _('Repositories to watch (owner/name, comma-separated; empty for all)'),
            text: settings.get_strv('repositories').join(', '),
        });
        reposRow.connect('changed', () => {
            const {repos, invalid} = parseRepoList(reposRow.get_text());
            if (invalid.length > 0)
                reposRow.add_css_class('error');
            else
                reposRow.remove_css_class('error');
            settings.set_strv('repositories', repos);
        });
        group.add(reposRow);

        const intervalRow = new Adw.SpinRow({
            title: _('Refresh interval'),
            subtitle: _('Minutes between checks'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 120, step_increment: 1}),
        });
        settings.bind('refresh-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(intervalRow);

        return group;
    }
}
