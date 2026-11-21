// Settings → Sync server: sign in to Source Glance Cloud or a server at an address you enter, so your
// accounts and settings follow you and the AI assistant works. The three plans are listed here too.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {CLOUD_SERVER, SERVER_CHOICES} from '../../lib/sync.js';

const PLANS = [
    {name: _('Individual'), text: _('Free, for one person')},
    {name: _('Startup'), text: _('Free for 6 months, then $5 a month, for up to 5 accounts; requires company email e.g. @your-company.com')},
    {name: _('Enterprise'), text: _('$0.99 per user a month, for 6 or more accounts; requires company email e.g. @your-company.com')},
];

/**
 * The three things a server can do, as switches (the Sync page and the question asked when connecting share them):
 * the AI button, an encrypted backup of account tokens, and saving settings, which is always on.
 */
function featureRows(settings) {
    const ai = new Adw.SwitchRow({title: _('Launch in AI button'),
        subtitle: _('Adds the AI assistant to issues and pull requests, with instructions from the server.')});
    settings.bind('sync-feature-ai', ai, 'active', Gio.SettingsBindFlags.DEFAULT);
    const tokens = new Adw.SwitchRow({title: _('Encrypted cloud backup of account tokens'),
        subtitle: _('Sends this computer’s signed-in accounts to the server, encrypted, so your other computers and the web app can use them. The server renews browser sign-ins, so they are renewed in one place only. Accounts other computers provide always come down, and only they can sign them out. Turning this off takes only this computer’s accounts off the server.')});
    settings.bind('sync-feature-tokens', tokens, 'active', Gio.SettingsBindFlags.DEFAULT);
    const save = new Adw.SwitchRow({title: _('Save settings'), active: true, sensitive: false,
        subtitle: _('Group by, organization and project names, hidden boards and your AI additions follow you. Always on.')});
    return [ai, tokens, save];
}

function choiceFor(url) {
    return url && url !== CLOUD_SERVER ? 'custom' : 'cloud';
}

/** `ctx` is {window, settings, sync}. Returns the page. */
export function buildSyncPage({window, settings, sync}) {
    const page = new Adw.PreferencesPage();
    const names = {cloud: _('Source Glance Cloud'), custom: _('Custom server address')};

    const group = new Adw.PreferencesGroup({title: _('Sync server'),
        description: _('Sign in once to keep your accounts, settings and the AI assistant in step on every computer. Accounts signed in with a personal access token are synced: the token is encrypted on the server. Browser sign-ins stay on this computer. Nothing is sent until you sign in. Choose Source Glance Cloud, or enter the address of your own server (https://, or http://localhost for one on this computer).')});
    const server = new Adw.ComboRow({title: _('Server'),
        model: Gtk.StringList.new(SERVER_CHOICES.map(choice => names[choice.id]))});
    group.add(server);
    const address = new Adw.EntryRow({title: _('Server address, e.g. https://sync.example.com')});
    address.set_input_purpose(Gtk.InputPurpose.URL);
    group.add(address);

    const status = new Adw.ActionRow({title: _('Not signed in')});
    const signIn = new Gtk.Button({label: _('Sign in'), valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
    const syncNow = new Gtk.Button({label: _('Sync now'), valign: Gtk.Align.CENTER});
    const signOut = new Gtk.Button({label: _('Sign out'), valign: Gtk.Align.CENTER});
    const cancel = new Gtk.Button({label: _('Cancel'), valign: Gtk.Align.CENTER});
    for (const button of [cancel, signOut, syncNow, signIn])
        status.add_suffix(button);
    group.add(status);

    const codeRow = new Adw.ActionRow({visible: false, title_selectable: true,
        subtitle: _('Paste this code on the page that opened in your browser (it is already copied), after signing in there. Waiting…')});
    const copy = new Gtk.Button({icon_name: 'edit-copy-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'],
        tooltip_text: _('Copy the code')});
    codeRow.add_suffix(copy);
    group.add(codeRow);

    const detail = new Adw.ActionRow({visible: false, subtitle_lines: 3});
    group.add(detail);
    page.add(group);

    const features = new Adw.PreferencesGroup({title: _('What the server does'),
        description: _('You are asked this when you connect, and can change it here at any time. Turning something off stops it at once; anything already stored on the server stays there until you remove it on the web.')});
    for (const row of featureRows(settings))
        features.add(row);
    page.add(features);

    const plans = new Adw.PreferencesGroup({title: _('Plans'),
        description: _('Everyone starts on Individual. Startup and Enterprise are for teams and require company email, e.g. @your-company.com; payment opens later.')});
    for (const plan of PLANS)
        plans.add(new Adw.ActionRow({title: plan.name, subtitle: plan.text, css_classes: ['property']}));
    const manage = new Adw.ActionRow({title: _('Devices and plan on the web'), activatable: true,
        subtitle: _('Sign out a computer, see your plan')});
    manage.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
    manage.connect('activated', () => {
        if (sync.server)
            new Gtk.UriLauncher({uri: `${sync.server}/app/devices`}).launch(window, null, null);
    });
    plans.add(manage);
    page.add(plans);

    let signingIn = false;
    let code = null;
    const customUrl = () => (choiceFor(sync.server) === 'custom' ? sync.server : '');

    const ago = date => {
        const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
        if (seconds < 60)
            return _('just now');
        return seconds < 3600 ? _('%d min ago').format(Math.round(seconds / 60)) : _('%d h ago').format(Math.round(seconds / 3600));
    };

    const refresh = () => {
        const signed = sync.signedIn;
        server.sensitive = !signed && !signingIn;
        address.visible = SERVER_CHOICES[server.selected]?.id === 'custom';
        address.sensitive = !signed && !signingIn;
        status.title = signed ? _('Signed in') : signingIn ? _('Waiting for approval') : _('Not signed in');
        // The plans are Source Glance Cloud's: a server of your own has none to show.
        const isCloud = signed ? choiceFor(sync.server) === 'cloud' : SERVER_CHOICES[server.selected]?.id === 'cloud';
        plans.visible = isCloud;
        status.subtitle = signed ? [sync.email, isCloud && sync.plan ? sync.plan.name : null].filter(Boolean).join(' · ') : '';
        signIn.visible = !signed && !signingIn;
        cancel.visible = signingIn;
        syncNow.visible = signed;
        signOut.visible = signed;
        syncNow.sensitive = !sync.busy;
        syncNow.label = sync.busy ? _('Syncing…') : _('Sync now');
        codeRow.visible = signingIn && code !== null;
        if (code)
            codeRow.title = code.userCode;
        manage.visible = signed && isCloud;

        const lines = [];
        if (signed && isCloud && sync.plan && !sync.plan.withinLimits)
            lines.push(...sync.plan.problems);
        if (signed && sync.lastSync) {
            const s = sync.summary;
            const done = s ? [s.pulled && _('%d added here').format(s.pulled), s.pushed && _('%d sent').format(s.pushed),
                s.removed && _('%d removed').format(s.removed)].filter(Boolean) : [];
            lines.push(_('Last synced %s').format(ago(sync.lastSync)) + (done.length ? `: ${done.join(', ')}` : ''));
            if (s?.kept)
                lines.push(_('%d account(s) were removed on the server and kept on this computer').format(s.kept));
            for (const problem of s?.problems ?? [])
                lines.push(problem);
        }
        if (sync.error)
            lines.push(_('Last attempt failed: %s').format(sync.error));
        detail.visible = lines.length > 0;
        detail.title = lines[0] ?? '';
        detail.subtitle = lines.slice(1).join('\n');
    };

    const start = SERVER_CHOICES.findIndex(choice => choice.id === choiceFor(sync.server));
    server.selected = Math.max(0, start);
    address.text = customUrl();
    address.connect('changed', refresh);
    server.connect('notify::selected', refresh);

    const startSignIn = async () => {
        const choice = SERVER_CHOICES[server.selected];
        const url = choice.id === 'custom' ? address.text : choice.url;
        signingIn = true;
        code = null;
        refresh();
        const result = await sync.signIn(url, info => {
            code = info;
            // Ready to paste on the server's page.
            Gdk.Display.get_default().get_clipboard().set(info.userCode);
            refresh();
        });
        signingIn = false;
        code = null;
        if (result.error)
            detail.add_css_class('error');
        else
            detail.remove_css_class('error');
        refresh();
        if (result.error) {
            detail.visible = true;
            detail.title = result.error;
            detail.subtitle = '';
        }
    };

    // Before connecting: which features to turn on. The choices are saved as the switches change, and used by the sync.
    signIn.connect('clicked', () => {
        const dialog = new Adw.AlertDialog({heading: _('What should this server do?'),
            body: _('Choose what to turn on. You can change this later in Settings → Sync server.')});
        const group = new Adw.PreferencesGroup();
        for (const row of featureRows(settings))
            group.add(row);
        dialog.set_extra_child(group);
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('connect', _('Connect'));
        dialog.set_response_appearance('connect', Adw.ResponseAppearance.SUGGESTED);
        dialog.set_default_response('connect');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_dialog, response) => {
            if (response === 'connect')
                void startSignIn();
        });
        dialog.present(window);
    });
    cancel.connect('clicked', () => sync.cancelSignIn());
    syncNow.connect('clicked', () => sync.sync({silent: false}));
    signOut.connect('clicked', () => sync.signOut());
    copy.connect('clicked', () => {
        if (code)
            Gdk.Display.get_default().get_clipboard().set(code.userCode);
    });

    sync.onChanged(refresh);
    refresh();
    // Keep the choice in step when the server is set from elsewhere.
    settings.connect('changed::sync-server', () => {
        const index = SERVER_CHOICES.findIndex(choice => choice.id === choiceFor(sync.server));
        if (index >= 0 && index !== server.selected)
            server.selected = index;
    });
    return page;
}

