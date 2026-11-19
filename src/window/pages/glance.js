// Glance: Widgets and System Tray on one scrolling page, each under its own heading with its
// quick settings beside it. The sidebar's entries for them scroll to their heading (scrollTo()).
// It fills the window's width, so the widget area shows as many cards across as fit.
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';
import {buildSystemTraySection} from './systemTray.js';
import {buildWidgetsSection} from './widgets.js';

/**
 * `ctx` is {window, settings, icons, toast}. Returns {widget, scrollTo(id), update(state)},
 * `id` 'widgets' or 'tray'.
 */
export function buildGlancePage(ctx) {
    const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, margin_top: 24, margin_bottom: 32,
        margin_start: 32, margin_end: 32});
    const view = new Gtk.ScrolledWindow({hscrollbar_policy: Gtk.PolicyType.AUTOMATIC, vexpand: true, child: content});

    const headings = {};
    const section = (id, title, {suffix, widget}) => {
        const heading = new Gtk.Box({spacing: 8, margin_top: id === 'widgets' ? 0 : 36, margin_bottom: 12});
        heading.append(new Gtk.Label({label: title, xalign: 0, hexpand: true, css_classes: ['title-2']}));
        if (suffix)
            heading.append(suffix);
        content.append(heading);
        content.append(widget);
        headings[id] = heading;
    };
    const widgets = buildWidgetsSection(ctx);
    section('widgets', _('Widgets'), widgets);
    section('tray', _('System Tray'), buildSystemTraySection(ctx));

    return {
        widget: view,
        update: state => widgets.update(state),
        scrollTo(id) {
            // After the page is shown and laid out, so the heading has its place.
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
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
