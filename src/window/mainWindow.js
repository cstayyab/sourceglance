// The sourceglance window: a sidebar of lists and settings, and the selected page.
// Built by window/app.js, in Source Glance's own app or GNOME's Extensions app.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from './i18n.js';

let themeLoaded = false;

/**
 * Loads theme.css once per process. Its rules are scoped to .sourceglance-window, so other
 * extensions' Settings windows (same process) aren't affected.
 */
export function loadTheme(window, dir) {
    window.add_css_class('sourceglance-window');
    if (themeLoaded)
        return;
    const provider = new Gtk.CssProvider();
    provider.load_from_path(dir.get_child('window').get_child('theme.css').get_path());
    Gtk.StyleContext.add_provider_for_display(window.get_display(), provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    themeLoaded = true;
}

function headingRow(text, styleClass) {
    return new Gtk.ListBoxRow({
        selectable: false,
        activatable: false,
        child: new Gtk.Label({label: text, xalign: 0, css_classes: [styleClass]}),
    });
}

function entryRow(entry) {
    const box = new Gtk.Box({spacing: 12});
    const image = entry.gicon ? new Gtk.Image({gicon: entry.gicon}) : new Gtk.Image({icon_name: entry.iconName});
    box.append(image);
    box.append(new Gtk.Label({label: entry.title, xalign: 0, hexpand: true}));
    const count = new Gtk.Label({css_classes: ['sourceglance-count-pill'], visible: false, valign: Gtk.Align.CENTER});
    box.append(count);
    const row = new Gtk.ListBoxRow({child: box});
    if (entry.indent || entry.parent)
        row.add_css_class('sourceglance-indent');
    if (entry.expandable) {
        // Shows or hides the entries under this one (entry.parent); clicking the row itself
        // still opens its page.
        row._expander = new Gtk.Button({css_classes: ['flat', 'sourceglance-expander'], valign: Gtk.Align.CENTER});
        box.append(row._expander);
    }
    row._entry = entry;
    row._count = count;
    return row;
}

/**
 * Replaces the window's content with the sidebar layout.
 *
 * @param {Adw.Window} window
 * @param {object} params
 * @param {Gio.Icon} params.appIcon
 * @param {Adw.ToastOverlay} params.overlay the window's toast overlay (pages use it)
 * @param {Array} params.entries [{heading, sub}] or [{id, title, iconName|gicon, page, indent}]. An
 *   entry with `expandable` (and `expanded`, `onExpandedChanged(expanded)`) shows or hides the
 *   entries whose `parent` is its id.
 * @param {Gtk.Widget} [params.headerStart] shown at the start of the content header bar
 * @param {Gtk.Widget} [params.headerEnd] shown at the end of the content header bar
 * @param {Function} [params.onPageChanged] called with the selected entry's id
 * @returns {{setCount(id: string, text: string): void, setSubtitle(text: string): void,
 *   select(id: string): void, current(): string|null}}
 */
export function buildMainWindow(window, {appIcon, overlay, entries, headerStart = null, headerEnd = null,
    onPageChanged = null}) {
    const list = new Gtk.ListBox({css_classes: ['navigation-sidebar', 'sourceglance-sidebar']});
    const stack = new Gtk.Stack({transition_type: Gtk.StackTransitionType.CROSSFADE});
    const rows = new Map();

    for (const entry of entries) {
        if (entry.heading) {
            list.append(headingRow(entry.heading, entry.sub ? 'sourceglance-sidebar-subheading' : 'sourceglance-sidebar-heading'));
            continue;
        }
        const row = entryRow(entry);
        rows.set(entry.id, row);
        list.append(row);
        stack.add_named(entry.page, entry.id);
    }

    const title = new Gtk.Box({spacing: 8, halign: Gtk.Align.CENTER});
    title.append(new Gtk.Image({gicon: appIcon, pixel_size: 24}));
    title.append(new Gtk.Label({label: 'Source Glance', css_classes: ['heading']}));
    const sidebarHeader = new Adw.HeaderBar({title_widget: title, css_classes: ['sourceglance-sidebar-header']});
    const sidebarView = new Adw.ToolbarView({
        content: new Gtk.ScrolledWindow({child: list, hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true}),
    });
    sidebarView.add_top_bar(sidebarHeader);
    const sidebarPage = new Adw.NavigationPage({title: 'Source Glance', child: sidebarView});

    const contentView = new Adw.ToolbarView({content: stack});
    // The page's name, with a subtitle such as the number of search results.
    const windowTitle = new Adw.WindowTitle();
    const contentHeader = new Adw.HeaderBar({title_widget: windowTitle});
    if (headerStart)
        contentHeader.pack_start(headerStart);
    if (headerEnd)
        contentHeader.pack_end(headerEnd);
    contentView.add_top_bar(contentHeader);
    const contentPage = new Adw.NavigationPage({title: '', child: contentView});

    const split = new Adw.NavigationSplitView({
        sidebar: sidebarPage,
        content: contentPage,
        min_sidebar_width: 230,
        max_sidebar_width: 280,
    });
    overlay.child = split;
    // GNOME's Extensions app checks that its window got a page (visible_page); add one,
    // then show our own layout instead of the default page view.
    if (window instanceof Adw.PreferencesWindow)
        window.add(new Adw.PreferencesPage());
    window.set_content(overlay);

    // Expandable entries: their children show only while they're expanded.
    const setExpanded = (parentRow, expanded) => {
        parentRow._expanded = expanded;
        parentRow._expander.icon_name = expanded ? 'pan-down-symbolic' : 'pan-end-symbolic';
        parentRow._expander.tooltip_text = expanded ? _('Hide the lists under this one') : _('Show the lists under this one');
        for (const row of rows.values()) {
            if (row._entry.parent === parentRow._entry.id)
                row.visible = expanded;
        }
        // A hidden page can't stay selected: its parent takes over.
        if (!expanded && list.get_selected_row()?._entry?.parent === parentRow._entry.id)
            list.select_row(parentRow);
    };
    for (const row of rows.values()) {
        if (!row._expander)
            continue;
        setExpanded(row, Boolean(row._entry.expanded));
        row._expander.connect('clicked', () => {
            setExpanded(row, !row._expanded);
            row._entry.onExpandedChanged?.(row._expanded);
        });
    }

    list.connect('row-selected', (_list, row) => {
        if (!row?._entry)
            return;
        stack.visible_child_name = row._entry.id;
        contentPage.title = row._entry.title;
        windowTitle.title = row._entry.title;
        split.show_content = true;
        onPageChanged?.(row._entry.id);
    });

    const select = id => {
        const row = rows.get(id);
        if (!row)
            return;
        // Opening a list under a collapsed one (e.g. from the top bar) shows it first.
        const parent = rows.get(row._entry.parent);
        if (parent?._expander && !parent._expanded) {
            setExpanded(parent, true);
            parent._entry.onExpandedChanged?.(true);
        }
        list.select_row(row);
    };
    // SOURCEGLANCE_PAGE (development) opens on a given page, e.g. for screenshots.
    select(GLib.getenv('SOURCEGLANCE_PAGE') ?? entries.find(entry => entry.id)?.id);

    return {
        current: () => list.get_selected_row()?._entry?.id ?? null,
        setCount(id, text) {
            const row = rows.get(id);
            if (!row)
                return;
            row._count.label = text;
            row._count.visible = text !== '';
        },
        setSubtitle(text) {
            windowTitle.subtitle = text;
        },
        select,
    };
}
