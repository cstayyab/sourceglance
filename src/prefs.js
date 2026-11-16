// sourceglance's window: GNOME opens it as the extension's Settings. It shows the lists and
// the settings in a sidebar layout (src/window/).
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {GitHubClient} from './lib/github.js';
import {GitLabClient} from './lib/gitlab.js';
import {listBadge} from './lib/model.js';
import {WindowActions} from './window/actions.js';
import {WindowData} from './window/data.js';
import {buildMainWindow, loadTheme} from './window/mainWindow.js';
import {UpdateButton} from './window/updateButton.js';
import {buildAboutPage} from './window/pages/about.js';
import {buildGithubPage} from './window/pages/github.js';
import {buildGitlabPage} from './window/pages/gitlab.js';
import {ListPage} from './window/pages/list.js';
import {ProjectsPage} from './window/pages/projects.js';
import {buildSystemStartPage} from './window/pages/systemStart.js';
import {buildSystemTrayPage} from './window/pages/systemTray.js';
import {buildWidgetsPage} from './window/pages/widgets.js';

export default class SourceglancePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const client = new GitHubClient(this.metadata['version-name'] ?? 'dev');
        const gitlabClient = new GitLabClient(this.metadata['version-name'] ?? 'dev');
        window.set_default_size(960, 680);
        loadTheme(window, this.dir);

        const icon = name => Gio.FileIcon.new(this.dir.get_child('icons').get_child(`${name}.svg`));
        const icons = {
            issue: icon('issue-symbolic'),
            issueClosed: icon('issue-closed-symbolic'),
            prMerged: icon('git-merge-symbolic'),
            prClosed: icon('pr-closed-symbolic'),
            pr: icon('git-pull-request-symbolic'),
            label: icon('label-symbolic'),
            projects: icon('checklist-symbolic'),
        };
        const overlay = new Adw.ToastOverlay();
        const toast = title => overlay.add_toast(new Adw.Toast({title}));
        const ctx = {window, settings, client, gitlabClient, toast, dir: this.dir};

        const pages = [];
        const data = new WindowData({client, gitlabClient, settings, onChange: state => {
            for (const page of pages)
                page.update(state);
            for (const id of ['issues', 'prs', 'projects'])
                main.setCount(id, listBadge(id, state));
            refresh.sensitive = !state.refreshing;
        }});
        const actions = new WindowActions({window, client, gitlabClient, data, toast});
        const repos = () => settings.get_strv('repositories');
        const issuesPage = new ListPage({key: 'issues', icons, actions, repos, settings});
        const prsPage = new ListPage({key: 'prs', icons, actions, repos, settings});
        const projectsPage = new ProjectsPage({icons, actions});
        pages.push(issuesPage, prsPage, projectsPage);

        const update = new UpdateButton({window, client, settings, toast, version: this.metadata['version-name'] ?? 'dev',
            currentPage: () => main?.current()});
        const refresh = new Gtk.Button({icon_name: 'view-refresh-symbolic', tooltip_text: _('Refresh')});
        refresh.connect('clicked', () => {
            data.refresh();
            update.check();
        });
        const headerEnd = new Gtk.Box({spacing: 6});
        headerEnd.append(update.widget);
        headerEnd.append(refresh);

        const main = buildMainWindow(window, {
            appIcon: icon('sourceglance-app'),
            overlay,
            headerEnd,
            entries: [
                {heading: _('Lists')},
                {id: 'issues', title: _('Issues'), iconName: 'checkbox-checked-symbolic', page: issuesPage.widget},
                {id: 'prs', title: _('Pull requests'), gicon: icons.pr, page: prsPage.widget},
                {id: 'projects', title: _('Projects'), gicon: icons.projects, page: projectsPage.widget},
                {heading: _('Settings')},
                {id: 'widgets', title: _('Desktop Widgets'), iconName: 'view-grid-symbolic',
                    page: buildWidgetsPage(ctx)},
                {id: 'tray', title: _('System Tray'), iconName: 'preferences-desktop-display-symbolic',
                    page: buildSystemTrayPage(ctx)},
                {heading: _('Accounts'), sub: true},
                {id: 'github', title: 'GitHub', iconName: 'avatar-default-symbolic', indent: true,
                    page: buildGithubPage(ctx)},
                {id: 'gitlab', title: 'GitLab', iconName: 'avatar-default-symbolic', indent: true,
                    page: buildGitlabPage(ctx)},
                {id: 'start', title: _('System Start'), iconName: 'system-run-symbolic',
                    page: buildSystemStartPage(ctx)},
                {id: 'about', title: _('About'), iconName: 'help-about-symbolic',
                    page: buildAboutPage({window, appIcon: icon('sourceglance-app'),
                        version: this.metadata['version-name'] ?? 'dev'})},
            ],
        });

        // The top-bar menu sets open-page (e.g. "about") before opening this window, and
        // again if the window is already open.
        const openPage = () => {
            const id = settings.get_string('open-page');
            if (!id)
                return;
            main.select(id);
            settings.set_string('open-page', '');
        };
        const openPageId = settings.connect('changed::open-page', openPage);
        openPage();

        // Signing in or out on the GitHub page reloads the lists.
        const tokenChangedId = settings.connect('changed::token-changed', () => data.refresh());
        window.connect('close-request', () => {
            settings.disconnect(tokenChangedId);
            settings.disconnect(openPageId);
            update.destroy();
            data.stop();
            client.destroy();
            gitlabClient.destroy();
            return false;
        });
        for (const page of pages)
            page.update(data.state);
        data.start();
        update.check();
    }
}
