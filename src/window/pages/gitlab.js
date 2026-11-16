// Accounts, GitLab section: sign in to gitlab.com with the device flow, or sign out.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {GITLAB_CLIENT_ID} from '../../lib/config.js';
import {DeviceFlowError, GitHubError, isCancelled} from '../../lib/github.js';
import {GITLAB_ACCOUNT, clearSecret, storeSecret} from '../../lib/tokenStore.js';

function describeError(error) {
    if (error instanceof DeviceFlowError) {
        switch (error.kind) {
        case 'expired':
            return _('The sign-in code expired. Try again.');
        case 'denied':
            return _('Sign-in was cancelled on GitLab.');
        default:
            return _('GitLab sign-in failed (%s).').format(error.detail);
        }
    }
    if (error instanceof GitHubError) {
        switch (error.kind) {
        case 'auth':
            return _('GitLab rejected the sign-in.');
        case 'network':
            return _('Couldn’t reach GitLab. Check your connection.');
        case 'rate-limit':
            return _('GitLab rate limit reached. Try again later.');
        default:
            return _('GitLab returned an error (HTTP %d).').format(error.status);
        }
    }
    return _('Something went wrong: %s').format(error.message);
}

/** The GitLab section of the Accounts page. `ctx` is {window, settings, gitlabClient, toast}. */
export function buildGitlabGroups({window, settings, gitlabClient: client, toast}) {
    const group = new Adw.PreferencesGroup({
        title: _('Account'),
        description: _('Your GitLab issues and merge requests show in their own section of each list.'),
    });

    const statusRow = new Adw.ActionRow({title: _('Status'), subtitle: _('Checking…')});
    const signOutButton = new Gtk.Button({label: _('Sign out'), valign: Gtk.Align.CENTER,
        css_classes: ['destructive-action'], visible: false});
    statusRow.add_suffix(signOutButton);
    group.add(statusRow);

    const signInRow = new Adw.ActionRow({
        title: _('Sign in with GitLab'),
        subtitle: GITLAB_CLIENT_ID
            ? _('Approve sourceglance on gitlab.com in your browser')
            : _('Not available in this build: the GitLab application isn’t configured.'),
    });
    const signInButton = new Gtk.Button({label: _('Sign in'), valign: Gtk.Align.CENTER,
        css_classes: ['suggested-action'], sensitive: Boolean(GITLAB_CLIENT_ID)});
    signInRow.add_suffix(signInButton);
    group.add(signInRow);

    const codeRow = new Adw.ActionRow({
        subtitle: _('Code copied. Approve sourceglance on GitLab. Waiting…'),
        title_selectable: true,
        css_classes: ['property'],
        visible: false,
    });
    const openButton = new Gtk.Button({icon_name: 'adw-external-link-symbolic', tooltip_text: _('Open GitLab again'),
        valign: Gtk.Align.CENTER, css_classes: ['flat']});
    const cancelButton = new Gtk.Button({label: _('Cancel'), valign: Gtk.Align.CENTER});
    codeRow.add_suffix(openButton);
    codeRow.add_suffix(cancelButton);
    group.add(codeRow);

    const setLogin = login => {
        statusRow.subtitle = login ? _('Signed in as @%s').format(login) : _('Not signed in');
        signOutButton.visible = Boolean(login);
        signInRow.visible = !login;
    };
    // Tells the running extension (and this window's lists) to reload.
    const notifyChanged = () => settings.set_int('token-changed', settings.get_int('token-changed') + 1);

    let cancellable = null;
    let verificationUri = null;
    const openVerification = () => {
        if (verificationUri)
            new Gtk.UriLauncher({uri: verificationUri}).launch(window, null, null);
    };
    window.connect('close-request', () => {
        cancellable?.cancel();
        return false;
    });

    signInButton.connect('clicked', async () => {
        const mine = new Gio.Cancellable();
        cancellable = mine;
        signInButton.sensitive = false;
        try {
            const code = await client.requestDeviceCode(GITLAB_CLIENT_ID, mine);
            verificationUri = code.verificationUri;
            codeRow.title = code.userCode;
            codeRow.visible = true;
            window.get_clipboard().set_content(Gdk.ContentProvider.new_for_bytes(
                'text/plain;charset=utf-8', new GLib.Bytes(new TextEncoder().encode(code.userCode))));
            openVerification();
            const auth = await client.waitForDeviceToken(GITLAB_CLIENT_ID, code, mine);
            const viewer = await client.getViewer(auth.access, mine);
            await storeSecret(GITLAB_ACCOUNT, JSON.stringify(auth));
            setLogin(viewer.username);
            notifyChanged();
            toast(_('Signed in to GitLab as @%s').format(viewer.username));
        } catch (e) {
            if (!isCancelled(e))
                toast(describeError(e));
        } finally {
            if (cancellable === mine) {
                cancellable = null;
                verificationUri = null;
                codeRow.visible = false;
                signInButton.sensitive = Boolean(GITLAB_CLIENT_ID);
            }
        }
    });
    openButton.connect('clicked', openVerification);
    cancelButton.connect('clicked', () => cancellable?.cancel());

    signOutButton.connect('clicked', async () => {
        try {
            await clearSecret(GITLAB_ACCOUNT);
            setLogin(null);
            notifyChanged();
            toast(_('Signed out of GitLab'));
        } catch (e) {
            toast(describeError(e));
        }
    });

    (async () => {
        try {
            const token = await client.accessToken(GITLAB_CLIENT_ID);
            setLogin(token ? (await client.getViewer(token)).username : null);
        } catch (e) {
            statusRow.subtitle = describeError(e);
            signOutButton.visible = true;
        }
    })();

    return [group];
}
