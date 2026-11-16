// The sourceglance window: a sidebar of lists and settings, and the selected page.
// Built inside the Settings window GNOME opens for the extension (see prefs.js).
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

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
    const count = new Gtk.Label({css_classes: ['sourceglance-count-pill'], visible: false});
    box.append(count);
    const row = new Gtk.ListBoxRow({child: box});
    if (entry.indent)
        row.add_css_class('sourceglance-indent');
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
 * @param {Array} params.entries [{heading, sub}] or [{id, title, iconName|gicon, page, indent}]
 * @returns {{setCount(id: string, text: string): void, select(id: string): void}}
 */
export function buildMainWindow(window, {appIcon, overlay, entries}) {
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
    title.append(new Gtk.Label({label: 'sourceglance', css_classes: ['heading']}));
    const sidebarHeader = new Adw.HeaderBar({title_widget: title, css_classes: ['sourceglance-sidebar-header']});
    const sidebarView = new Adw.ToolbarView({
        content: new Gtk.ScrolledWindow({child: list, hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true}),
    });
    sidebarView.add_top_bar(sidebarHeader);
    const sidebarPage = new Adw.NavigationPage({title: 'sourceglance', child: sidebarView});

    const contentView = new Adw.ToolbarView({content: stack});
    contentView.add_top_bar(new Adw.HeaderBar());
    const contentPage = new Adw.NavigationPage({title: '', child: contentView});

    const split = new Adw.NavigationSplitView({
        sidebar: sidebarPage,
        content: contentPage,
        min_sidebar_width: 230,
        max_sidebar_width: 280,
    });
    overlay.child = split;
    // GNOME's Extensions app checks that the window got a page (visible_page); add one,
    // then show our own layout instead of the default page view.
    window.add(new Adw.PreferencesPage());
    window.set_content(overlay);

    list.connect('row-selected', (_list, row) => {
        if (!row?._entry)
            return;
        stack.visible_child_name = row._entry.id;
        contentPage.title = row._entry.title;
        split.show_content = true;
    });

    const select = id => {
        const row = rows.get(id);
        if (row)
            list.select_row(row);
    };
    select(entries.find(entry => entry.id)?.id);

    return {
        setCount(id, text) {
            const row = rows.get(id);
            if (!row)
                return;
            row._count.label = text;
            row._count.visible = text !== '';
        },
        select,
    };
}
