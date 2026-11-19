// Glance: Desktop Widgets and System Tray on one scrolling page, each under its own heading.
// The sidebar's entries for them scroll to their heading (scrollTo()).
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';
import {buildSystemTrayPage} from './systemTray.js';
import {buildWidgetsPage} from './widgets.js';

/** `ctx` is {window, settings, toast}. Returns {widget, scrollTo(id)}, `id` 'widgets' or 'tray'. */
export function buildGlancePage(ctx) {
    const page = new Adw.PreferencesPage();
    const headings = {};
    const heading = (id, title) => {
        const group = new Adw.PreferencesGroup({margin_top: id === 'widgets' ? 0 : 18});
        group.add(new Gtk.Label({label: title, xalign: 0, css_classes: ['title-2']}));
        page.add(group);
        headings[id] = group;
    };
    heading('widgets', _('Desktop Widgets'));
    buildWidgetsPage(ctx, page);
    heading('tray', _('System Tray'));
    buildSystemTrayPage(ctx, page);

    const scrolled = () => {
        for (let child = page.get_first_child(); child; child = child.get_next_sibling()) {
            if (child instanceof Gtk.ScrolledWindow)
                return child;
        }
        return null;
    };
    return {
        widget: page,
        scrollTo(id) {
            // After the page is shown and laid out, so the heading has its place.
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                const view = scrolled();
                const content = view?.child?.child;
                if (!content)
                    return GLib.SOURCE_REMOVE;
                const [ok, point] = headings[id].compute_point(content, new Graphene.Point({x: 0, y: 0}));
                const adjustment = view.vadjustment;
                if (ok) {
                    adjustment.value = Math.min(Math.max(0, point.y - 12),
                        adjustment.upper - adjustment.page_size);
                }
                return GLib.SOURCE_REMOVE;
            });
        },
    };
}
