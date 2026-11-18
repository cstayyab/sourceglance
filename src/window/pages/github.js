// Accounts, GitHub section: sign-in (device flow) and which repositories to watch.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {GITHUB_APP_CLIENT_ID, GITHUB_APP_SLUG, OAUTH_CLIENT_ID, SHOW_OTHER_SIGN_IN_OPTIONS} from '../../lib/config.js';
import {DeviceFlowError, GitHubError, isCancelled} from '../../lib/github.js';
import {FULL_ACCESS_SCOPE, appInstallUrl, parseRepoList} from '../../lib/model.js';
import {clearToken, lookupToken, storeToken} from '../../lib/tokenStore.js';

const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export function describeError(error) {
    if (error instanceof DeviceFlowError) {
        switch (error.kind) {
        case 'expired':
            return _('The sign-in code expired. Try again.');
        case 'denied':
            return _('Sign-in was cancelled on GitHub.');
        default:
            return _('GitHub sign-in failed (%s).').format(error.detail);
        }
    }
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

function buildAccountGroup({window, settings, client, toast}) {
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

    // Device flow: the user approves a short code on github.com while we poll for the token.
    // The default sign-in uses the GitHub App, limited to issues, pull requests and projects;
    // full access is an explicit opt-in.
    const signInRow = new Adw.ActionRow({
        title: _('Sign in with GitHub'),
        subtitle: GITHUB_APP_CLIENT_ID
            ? _('Access to issues, pull requests and projects only. Public repositories are read-only unless the app is installed there')
            : _('Not available in this build: the GitHub App isn’t configured.'),
    });
    const signInButton = new Gtk.Button({
        label: _('Sign in'),
        valign: Gtk.Align.CENTER,
        css_classes: ['suggested-action'],
        sensitive: Boolean(GITHUB_APP_CLIENT_ID),
    });
    signInRow.add_suffix(signInButton);
    group.add(signInRow);

    const installUrl = appInstallUrl(GITHUB_APP_SLUG);
    const reposRow = new Adw.ActionRow({
        title: _('Choose repositories'),
        subtitle: _('Pick the repositories Source Glance may change and, if private, see'),
        activatable: true,
        visible: Boolean(GITHUB_APP_CLIENT_ID && installUrl),
    });
    reposRow.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
    reposRow.connect('activated', () => {
        new Gtk.UriLauncher({uri: installUrl}).launch(window, null, null);
    });
    group.add(reposRow);

    const codeRow = new Adw.ActionRow({
        subtitle: _('Code copied. Paste it on GitHub and approve. Waiting…'),
        title_selectable: true,
        css_classes: ['property'],
        visible: false,
    });
    const openButton = new Gtk.Button({
        icon_name: 'adw-external-link-symbolic',
        tooltip_text: _('Open GitHub again'),
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    const cancelButton = new Gtk.Button({label: _('Cancel'), valign: Gtk.Align.CENTER});
    codeRow.add_suffix(openButton);
    codeRow.add_suffix(cancelButton);
    group.add(codeRow);

    const moreExpander = new Adw.ExpanderRow({
        title: _('More sign-in options'),
        expanded: !GITHUB_APP_CLIENT_ID,
        visible: SHOW_OTHER_SIGN_IN_OPTIONS,
    });
    group.add(moreExpander);

    const fullAccessRow = new Adw.ActionRow({
        title: _('Sign in with full access'),
        subtitle: OAUTH_CLIENT_ID
            ? _('Also sees private repositories owned by others. Grants write access to ' +
                'all your repositories and project boards.')
            : _('Not available in this build.'),
    });
    const fullAccessButton = new Gtk.Button({
        label: _('Sign in'),
        valign: Gtk.Align.CENTER,
        sensitive: Boolean(OAUTH_CLIENT_ID),
    });
    fullAccessRow.add_suffix(fullAccessButton);
    moreExpander.add_row(fullAccessRow);

    const tokenRow = new Adw.PasswordEntryRow({
        title: _('Personal access token'),
        show_apply_button: true,
    });
    moreExpander.add_row(tokenRow);

    const linkRow = new Adw.ActionRow({
        title: _('Create a token'),
        subtitle: _('Fine-grained token with “Issues” and “Metadata” access'),
        activatable: true,
    });
    linkRow.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
    linkRow.connect('activated', () => {
        new Gtk.UriLauncher({uri: NEW_TOKEN_URL}).launch(window, null, null);
    });
    moreExpander.add_row(linkRow);

    const setLogin = login => {
        statusRow.subtitle = login ? _('Signed in as @%s').format(login) : _('Not signed in');
        signOutButton.visible = Boolean(login);
    };
    // Tells the running extension to re-read the keyring right away.
    const notifyTokenChanged = () =>
        settings.set_int('token-changed', settings.get_int('token-changed') + 1);

    // Validates a token, stores it and updates the UI. Throws on failure.
    const signInWith = async (token, cancellable = null) => {
        const login = await client.getViewer(token, cancellable);
        await storeToken(token);
        setLogin(login);
        notifyTokenChanged();
        toast(_('Signed in as @%s').format(login));
    };

    let deviceCancellable = null;
    let verificationUri = null;
    const openVerification = () => {
        if (verificationUri)
            new Gtk.UriLauncher({uri: verificationUri}).launch(window, null, null);
    };
    window.connect('close-request', () => {
        deviceCancellable?.cancel();
        return false;
    });

    const deviceSignIn = async (clientId, scope) => {
        const cancellable = new Gio.Cancellable();
        deviceCancellable = cancellable;
        signInButton.sensitive = false;
        fullAccessButton.sensitive = false;
        try {
            const code = await client.requestDeviceCode(clientId, scope, cancellable);
            verificationUri = code.verificationUri;
            codeRow.title = code.userCode;
            codeRow.visible = true;
            window.get_clipboard().set_content(Gdk.ContentProvider.new_for_bytes(
                'text/plain;charset=utf-8', new GLib.Bytes(new TextEncoder().encode(code.userCode))));
            openVerification();

            const token = await client.waitForDeviceToken(clientId, code, cancellable);
            await signInWith(token, cancellable);
        } catch (e) {
            if (!isCancelled(e))
                toast(describeError(e));
        } finally {
            if (deviceCancellable === cancellable) {
                deviceCancellable = null;
                verificationUri = null;
                codeRow.visible = false;
                signInButton.sensitive = Boolean(GITHUB_APP_CLIENT_ID);
                fullAccessButton.sensitive = Boolean(OAUTH_CLIENT_ID);
            }
        }
    };
    // GitHub Apps ignore scopes: their permissions are fixed in the app's settings.
    signInButton.connect('clicked', () => deviceSignIn(GITHUB_APP_CLIENT_ID, null));
    fullAccessButton.connect('clicked', () => deviceSignIn(OAUTH_CLIENT_ID, FULL_ACCESS_SCOPE));
    openButton.connect('clicked', openVerification);
    cancelButton.connect('clicked', () => deviceCancellable?.cancel());

    tokenRow.connect('apply', async () => {
        const token = tokenRow.get_text().trim();
        if (!token)
            return;
        tokenRow.sensitive = false;
        try {
            await signInWith(token);
            tokenRow.set_text('');
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

function buildRepositoriesGroup({settings}) {
    const group = new Adw.PreferencesGroup({
        title: _('Repositories'),
        description: _('Limit the lists to some repositories. Leave empty to see everything assigned to you.'),
    });

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

    return group;
}

/** The GitHub section of the Accounts page. `ctx` is {window, settings, client, toast}. */
export function buildGithubGroups(ctx) {
    return [buildAccountGroup(ctx), buildRepositoriesGroup(ctx)];
}
