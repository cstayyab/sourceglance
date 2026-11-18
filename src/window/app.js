// Fills a window with Source Glance's sidebar layout: the lists, the settings and their
// toolbar. launcher.js shows it in Source Glance's own app; prefs.js in GNOME's Extensions app.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {AccountClients} from '../lib/accountStore.js';
import {GitHubClient} from '../lib/github.js';
import {listBadge, searchCount, searchTerms} from '../lib/model.js';
import {WindowActions} from './actions.js';
import {WindowData} from './data.js';
import {gettext as _, ngettext} from './i18n.js';
import {buildMainWindow, loadTheme} from './mainWindow.js';
import {UpdateButton} from './updateButton.js';
import {buildAboutPage} from './pages/about.js';
import {buildAccountsPage} from './pages/accounts.js';
import {ListPage} from './pages/list.js';
import {ProjectsPage} from './pages/projects.js';
import {TasksPage} from './pages/tasks.js';
import {buildSystemStartPage} from './pages/systemStart.js';
import {buildSystemTrayPage} from './pages/systemTray.js';
import {buildWidgetsPage} from './pages/widgets.js';

/**
 * @param {Adw.Window} window
 * @param {object} params
 * @param {Gio.Settings} params.settings the extension's settings
 * @param {Gio.File} params.dir the folder with this version's files
 * @param {string} params.version e.g. "0.4.2"
 */
export function fillWindow(window, {settings, dir, version}) {
    // For the update check: sourceglance's releases are on github.com.
    const client = new GitHubClient(version);
    // One client per account, for the lists, the actions and Settings → Accounts.
    const clients = new AccountClients(version);
    window.set_default_size(960, 680);
    loadTheme(window, dir);

    const icon = name => Gio.FileIcon.new(dir.get_child('icons').get_child(`${name}.svg`));
    const icons = {
        issue: icon('issue-symbolic'),
        issueClosed: icon('issue-closed-symbolic'),
        prMerged: icon('git-merge-symbolic'),
        prClosed: icon('pr-closed-symbolic'),
        pr: icon('git-pull-request-symbolic'),
        label: icon('label-symbolic'),
        projects: icon('checklist-symbolic'),
        code: icon('code-symbolic'),
    };
    const overlay = new Adw.ToastOverlay();
    const toast = title => overlay.add_toast(new Adw.Toast({title}));
    const ctx = {window, settings, client, clients, version, toast, dir: dir};

    // One search box, on the right of the title bar, filters all three lists. While it has text, the
    // sidebar counts and the title's subtitle show matches; clearing it shows everything.
    // Tasks first: a search from a settings page shows it.
    const LISTS = ['tasks', 'issues', 'prs', 'projects'];
    const search = new Gtk.SearchEntry({placeholder_text: _('Search lists'), width_chars: 20, valign: Gtk.Align.CENTER,
        tooltip_text: _('Search issues, pull requests and project items (Ctrl+F). Esc clears it.')});
    let currentPage = null;
    let terms = [];
    // Set once the layout is built; pages can change (and call back) while it's being built.
    let main = null;
    const showCounts = () => {
        const state = data.state;
        for (const id of LISTS)
            main?.setCount(id, terms.length ? String(searchCount(id, state, terms)) : listBadge(id, state));
        const n = terms.length && LISTS.includes(currentPage) ? searchCount(currentPage, state, terms) : null;
        main?.setSubtitle(n === null ? '' : ngettext('%d result', '%d results', n).format(n));
    };

    const pages = [];
    const data = new WindowData({clients, settings, onChange: state => {
        for (const page of pages)
            page.update(state);
        showCounts();
        refresh.sensitive = !state.refreshing;
    }});
    // The preview shows in the window's right panel (built with the layout, below).
    const panel = {
        show: params => main?.showPanel(params),
        hide: () => main?.hidePanel(),
        isFor: owner => main?.isPanelFor(owner) ?? false,
    };
    const actions = new WindowActions({window, clients, data, toast, icons, panel});
    const repos = () => settings.get_strv('repositories');
    const onClearSearch = () => {
        search.text = '';
    };
    const issuesPage = new ListPage({key: 'issues', icons, actions, repos, settings, onClearSearch});
    const prsPage = new ListPage({key: 'prs', icons, actions, repos, settings, onClearSearch});
    const projectsPage = new ProjectsPage({icons, actions, settings, onClearSearch});
    const tasksPage = new TasksPage({icons, actions, onClearSearch});
    pages.push(tasksPage, issuesPage, prsPage, projectsPage);

    search.connect('search-changed', () => {
        terms = searchTerms(search.text);
        // Searching from a settings page shows the first list; clearing it there does too.
        // On a list, the selection stays.
        if (!LISTS.includes(currentPage))
            main?.select(LISTS[0]);
        for (const page of pages)
            page.setSearch(search.text.trim(), terms);
        showCounts();
    });
    // Esc in the box clears it.
    search.connect('stop-search', onClearSearch);

    const update = new UpdateButton({window, client, settings, toast, version: version,
        currentPage: () => main?.current()});
    const refresh = new Gtk.Button({icon_name: 'view-refresh-symbolic', tooltip_text: _('Refresh')});
    refresh.connect('clicked', () => {
        data.refresh();
        update.check();
    });
    // The search box sits on the right of the title, always shown, next to the buttons.
    const headerEnd = new Gtk.Box({spacing: 6});
    headerEnd.append(search);
    headerEnd.append(update.widget);
    headerEnd.append(refresh);

    main = buildMainWindow(window, {
        appIcon: icon('sourceglance-app'),
        overlay,
        headerEnd,
        onPageChanged: id => {
            currentPage = id;
            showCounts();
        },
        entries: [
            {heading: _('Lists')},
            // Everything in one list; the lists by kind sit under it, collapsed until opened.
            {id: 'tasks', title: _('Tasks'), iconName: 'view-list-bullet-symbolic', page: tasksPage.widget,
                expandable: true, expanded: settings.get_boolean('tasks-expanded'),
                onExpandedChanged: expanded => settings.set_boolean('tasks-expanded', expanded)},
            {id: 'issues', parent: 'tasks', title: _('Issues'), iconName: 'checkbox-checked-symbolic', page: issuesPage.widget},
            {id: 'prs', parent: 'tasks', title: _('Pull requests'), gicon: icons.pr, page: prsPage.widget},
            {id: 'projects', parent: 'tasks', title: _('Projects'), gicon: icons.projects, page: projectsPage.widget},
            {heading: _('Settings')},
            {id: 'widgets', title: _('Desktop Widgets'), iconName: 'view-grid-symbolic',
                page: buildWidgetsPage(ctx)},
            {id: 'tray', title: _('System Tray'), iconName: 'preferences-desktop-display-symbolic',
                page: buildSystemTrayPage(ctx)},
            {id: 'accounts', title: _('Accounts'), iconName: 'avatar-default-symbolic',
                page: buildAccountsPage(ctx)},
            {id: 'start', title: _('System Start'), iconName: 'system-run-symbolic',
                page: buildSystemStartPage(ctx)},
            {id: 'about', title: _('About'), iconName: 'help-about-symbolic',
                page: buildAboutPage({window, appIcon: icon('sourceglance-app'),
                    version: version})},
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

    // Esc clears a search first, wherever the focus is; GNOME's Extensions app would otherwise close the window.
    const escape = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
    escape.connect('key-pressed', (_controller, keyval) => {
        if (keyval !== Gdk.KEY_Escape || search.text === '')
            return false;
        // In a dialog (comment, close, pickers), Esc closes the dialog as usual.
        if (window.get_focus()?.get_ancestor(Adw.Dialog.$gtype))
            return false;
        onClearSearch();
        return true;
    });
    window.add_controller(escape);

    // Typing on a list goes into the search box; Ctrl+F jumps there from any page.
    search.set_key_capture_widget(window);
    const shortcuts = new Gtk.ShortcutController({scope: Gtk.ShortcutScope.LOCAL});
    shortcuts.add_shortcut(new Gtk.Shortcut({
        trigger: Gtk.ShortcutTrigger.parse_string('<Control>f'),
        action: Gtk.CallbackAction.new(() => {
            search.grab_focus();
            return true;
        }),
    }));
    window.add_controller(shortcuts);

    // The update notification's Install sets install-update before opening this window, or
    // while it's open.
    const installUpdate = () => {
        if (!settings.get_boolean('install-update'))
            return;
        settings.set_boolean('install-update', false);
        update.install();
    };
    const installUpdateId = settings.connect('changed::install-update', installUpdate);

    // Adding or removing an account under Settings → Accounts reloads the lists.
    const tokenChangedId = settings.connect('changed::token-changed', () => data.refresh());
    window.connect('close-request', () => {
        settings.disconnect(tokenChangedId);
        settings.disconnect(openPageId);
        settings.disconnect(installUpdateId);
        update.destroy();
        data.stop();
        client.destroy();
        clients.destroy();
        return false;
    });
    for (const page of pages)
        page.update(data.state);
    data.start();
    update.check();
    installUpdate();
}
