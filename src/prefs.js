// sourceglance's window: GNOME opens it as the extension's Settings. It shows the lists and
// the settings in a sidebar layout (src/window/).
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {GitHubClient} from './lib/github.js';
import {buildMainWindow, loadTheme} from './window/mainWindow.js';
import {buildGithubPage} from './window/pages/github.js';
import {buildPlaceholderPage} from './window/pages/placeholder.js';
import {buildSystemStartPage} from './window/pages/systemStart.js';
import {buildSystemTrayPage} from './window/pages/systemTray.js';

export default class SourceglancePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const client = new GitHubClient(this.metadata['version-name'] ?? 'dev');
        window.connect('close-request', () => {
            client.destroy();
            return false;
        });
        window.set_default_size(960, 640);
        loadTheme(window, this.dir);

        const icon = name => Gio.FileIcon.new(this.dir.get_child('icons').get_child(`${name}.svg`));
        const overlay = new Adw.ToastOverlay();
        const toast = title => overlay.add_toast(new Adw.Toast({title}));
        const ctx = {window, settings, client, toast, dir: this.dir};

        const comingSoon = (iconName, title, description) => buildPlaceholderPage({iconName, title, description});
        buildMainWindow(window, {
            appIcon: icon('sourceglance-app'),
            overlay,
            entries: [
                {heading: _('Lists')},
                {id: 'issues', title: _('Issues'), iconName: 'checkbox-checked-symbolic',
                    page: comingSoon('checkbox-checked-symbolic', _('Issues'), _('Your issues will show here.'))},
                {id: 'prs', title: _('Pull requests'), gicon: icon('git-pull-request-symbolic'),
                    page: comingSoon('view-list-symbolic', _('Pull requests'), _('Your pull requests will show here.'))},
                {id: 'projects', title: _('Projects'), gicon: icon('checklist-symbolic'),
                    page: comingSoon('view-list-symbolic', _('Projects'), _('Your project boards will show here.'))},
                {heading: _('Settings')},
                {id: 'widgets', title: _('Desktop Widgets'), iconName: 'view-grid-symbolic',
                    page: comingSoon('view-grid-symbolic', _('Desktop Widgets'),
                        _('Cards with your issues, pull requests and projects on the desktop.'))},
                {id: 'tray', title: _('System Tray'), iconName: 'preferences-desktop-display-symbolic',
                    page: buildSystemTrayPage(ctx)},
                {heading: _('Accounts'), sub: true},
                {id: 'github', title: 'GitHub', iconName: 'avatar-default-symbolic', indent: true,
                    page: buildGithubPage(ctx)},
                {id: 'gitlab', title: 'GitLab', iconName: 'avatar-default-symbolic', indent: true,
                    page: comingSoon('avatar-default-symbolic', 'GitLab', _('Sign in with GitLab to see your issues and merge requests.'))},
                {id: 'start', title: _('System Start'), iconName: 'system-run-symbolic',
                    page: buildSystemStartPage(ctx)},
            ],
        });
    }
}
