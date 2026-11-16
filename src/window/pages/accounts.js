// Settings → Accounts: GitHub and GitLab, each under its own heading.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {buildGithubGroups} from './github.js';
import {buildGitlabGroups} from './gitlab.js';

/** A large heading, as a group of its own, so the sections read like one page. */
function heading(text, first) {
    const group = new Adw.PreferencesGroup();
    group.add(new Gtk.Label({label: text, xalign: 0, css_classes: ['title-2'], margin_top: first ? 0 : 12}));
    return group;
}

/** `ctx` is {window, settings, client, gitlabClient, toast}. */
export function buildAccountsPage(ctx) {
    const page = new Adw.PreferencesPage();
    page.add(heading('GitHub', true));
    for (const group of buildGithubGroups(ctx))
        page.add(group);
    page.add(heading('GitLab', false));
    for (const group of buildGitlabGroups(ctx))
        page.add(group);
    return page;
}
