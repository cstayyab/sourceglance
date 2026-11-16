// About: version, author, and how to report issues or contribute (fork and pull request).
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {AUTHOR_GITHUB, AUTHOR_NAME, HOME_URL, REPO_URL} from '../../lib/config.js';

/** A row that opens `uri` in the browser. */
function linkRow(window, {title, subtitle = null, uri, iconName = null}) {
    const row = new Adw.ActionRow({title, subtitle, activatable: true, tooltip_text: uri});
    if (iconName)
        row.add_prefix(new Gtk.Image({icon_name: iconName}));
    row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
    row.connect('activated', () => new Gtk.UriLauncher({uri}).launch(window, null, null));
    return row;
}

/** `ctx` is {window, appIcon, version}. */
export function buildAboutPage({window, appIcon, version}) {
    const page = new Adw.PreferencesPage();

    const header = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, halign: Gtk.Align.CENTER,
        margin_top: 12, margin_bottom: 6});
    header.append(new Gtk.Image({gicon: appIcon, pixel_size: 96, margin_bottom: 6}));
    header.append(new Gtk.Label({label: 'sourceglance', css_classes: ['title-1']}));
    header.append(new Gtk.Label({label: _('Version %s').format(version), css_classes: ['dim-label']}));
    header.append(new Gtk.Label({
        label: _('Your GitHub and GitLab issues, pull requests and project boards, one glance away.'),
        wrap: true, justify: Gtk.Justification.CENTER, max_width_chars: 50, margin_top: 6,
    }));
    const headerGroup = new Adw.PreferencesGroup();
    headerGroup.add(header);
    page.add(headerGroup);

    const author = new Adw.PreferencesGroup({title: _('Author')});
    author.add(linkRow(window, {
        title: AUTHOR_NAME,
        subtitle: `@${AUTHOR_GITHUB}`,
        uri: `https://github.com/${AUTHOR_GITHUB}`,
        iconName: 'avatar-default-symbolic',
    }));
    page.add(author);

    const involved = new Adw.PreferencesGroup({
        title: _('Get involved'),
        description: _('sourceglance is open source. Found a bug or have an idea? Report it, or fork the repository and send a pull request.'),
    });
    involved.add(linkRow(window, {
        title: _('Report an issue'),
        subtitle: _('Bugs, ideas and questions are all welcome'),
        uri: `${REPO_URL}/issues/new/choose`,
        iconName: 'dialog-warning-symbolic',
    }));
    involved.add(linkRow(window, {
        title: _('Fork and contribute'),
        subtitle: _('Fork the repository, make your change and open a pull request'),
        uri: `${REPO_URL}/fork`,
        iconName: 'system-software-install-symbolic',
    }));
    involved.add(linkRow(window, {
        title: _('Contributing guide'),
        subtitle: _('How to set up, test and submit a change'),
        uri: `${REPO_URL}/blob/main/CONTRIBUTING.md`,
        iconName: 'accessories-text-editor-symbolic',
    }));
    page.add(involved);

    const project = new Adw.PreferencesGroup({title: _('Project')});
    project.add(linkRow(window, {title: _('Home page'), uri: HOME_URL, iconName: 'go-home-symbolic'}));
    project.add(linkRow(window, {title: _('Source code'), subtitle: REPO_URL.replace('https://', ''), uri: REPO_URL,
        iconName: 'folder-symbolic'}));
    project.add(linkRow(window, {title: _('Release notes'), uri: `${REPO_URL}/releases`,
        iconName: 'document-open-recent-symbolic'}));
    project.add(linkRow(window, {title: _('License'), subtitle: _('MIT License, with no warranty'),
        uri: `${REPO_URL}/blob/main/LICENSE`, iconName: 'emblem-documents-symbolic'}));
    page.add(project);

    return page;
}
