// Settings: starting with your session, the app icon, Start now, updates and About. About
// slides in from the right, over the settings. A status bar at the foot has the copyright notice.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {AUTHOR_NAME, COPYRIGHT_YEAR} from '../../lib/config.js';

function settingsContent({settings, toast, onAbout}) {
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({title: _('Startup')});
    page.add(group);

    const autostartRow = new Adw.SwitchRow({
        title: _('Start automatically'),
        subtitle: _('Show Source Glance in the top bar when you log in'),
    });
    settings.bind('start-automatically', autostartRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(autostartRow);

    const launcherRow = new Adw.SwitchRow({
        title: _('Show in app grid'),
        subtitle: _('An app icon that starts Source Glance and opens this window'),
    });
    settings.bind('app-launcher', launcherRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(launcherRow);

    // After Quit, this is the way back without logging out.
    const startRow = new Adw.ActionRow({
        title: _('Start now'),
        subtitle: _('Show Source Glance in the top bar again after you chose Quit'),
    });
    const startButton = new Gtk.Button({label: _('Start'), valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
    startButton.connect('clicked', () => {
        settings.set_int('start-request', settings.get_int('start-request') + 1);
        toast(_('Source Glance is starting'));
    });
    startRow.add_suffix(startButton);
    group.add(startRow);

    const updates = new Adw.PreferencesGroup({
        title: _('Updates'),
        description: _('Source Glance asks GitHub for its newest release; nothing about you is sent. One Setup file installs, updates, repairs and removes Source Glance.'),
    });
    const updatesRow = new Adw.SwitchRow({
        title: _('Check for updates'),
        subtitle: _('When a newer version is out, say so when you log in and show “Update available” in the title bar'),
    });
    settings.bind('check-updates', updatesRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    updates.add(updatesRow);
    page.add(updates);

    const aboutGroup = new Adw.PreferencesGroup({title: _('About')});
    const aboutRow = new Adw.ActionRow({
        title: _('About Source Glance'),
        subtitle: _('Version, author, and how to report issues or contribute'),
        activatable: true,
    });
    aboutRow.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
    aboutRow.connect('activated', onAbout);
    aboutGroup.add(aboutRow);
    page.add(aboutGroup);

    return page;
}

/**
 * `ctx` is {settings, toast, about}, `about` the About page (pages/about.js). Returns
 * {widget, showAbout()}.
 */
export function buildSystemStartPage({settings, toast, about}) {
    // About, in a panel that slides over the settings from the right.
    const close = new Gtk.Button({icon_name: 'window-close-symbolic', tooltip_text: _('Close'),
        css_classes: ['flat'], valign: Gtk.Align.CENTER});
    const aboutPanel = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, width_request: 380,
        css_classes: ['sourceglance-panel', 'sourceglance-about-panel']});
    aboutPanel.append(new Gtk.CenterBox({center_widget: new Adw.WindowTitle({title: _('About')}), end_widget: close,
        css_classes: ['sourceglance-panel-head']}));
    aboutPanel.append(new Gtk.Separator());
    about.vexpand = true;
    aboutPanel.append(about);
    const revealer = new Gtk.Revealer({child: aboutPanel, halign: Gtk.Align.END,
        transition_type: Gtk.RevealerTransitionType.SLIDE_LEFT});
    const showAbout = () => {
        // At least half the window wide, but never wider than the settings it covers.
        // (Opened from the top bar, the page isn't laid out yet: no width to keep within.)
        const windowWidth = revealer.get_root()?.get_width() ?? 0;
        if (windowWidth > 0)
            aboutPanel.width_request = Math.min(overlay.get_width() || Infinity, Math.max(380, Math.round(windowWidth * 0.5)));
        revealer.reveal_child = true;
    };
    close.connect('clicked', () => {
        revealer.reveal_child = false;
    });
    const overlay = new Gtk.Overlay({child: settingsContent({settings, toast, onAbout: showAbout})});
    overlay.add_overlay(revealer);

    // The status bar: the copyright notice.
    const status = new Gtk.Box({spacing: 8, css_classes: ['sourceglance-status-bar']});
    status.append(new Gtk.Label({label: _('© %s %s · Apache License 2.0').format(COPYRIGHT_YEAR, AUTHOR_NAME), xalign: 0,
        hexpand: true, margin_top: 6, margin_bottom: 6, css_classes: ['dim-label', 'caption']}));

    const widget = new Adw.ToolbarView({content: overlay});
    widget.add_bottom_bar(status);
    return {widget, showAbout};
}
