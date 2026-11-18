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

// The sidebar's widths: icons only, or icons with their names and counts.
const NARROW_WIDTH = 64;
const WIDE_WIDTH = [230, 280];

// A heading, or a line in its place while the sidebar shows icons only.
function headingRow(text, styleClass) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    const label = new Gtk.Label({label: text, xalign: 0, css_classes: [styleClass]});
    const line = new Gtk.Separator({visible: false, margin_top: 8, margin_bottom: 8});
    box.append(label);
    box.append(line);
    const row = new Gtk.ListBoxRow({selectable: false, activatable: false, child: box});
    row._setNarrow = narrow => {
        label.visible = !narrow;
        line.visible = narrow;
    };
    return row;
}

function entryRow(entry) {
    const box = new Gtk.Box({spacing: 12});
    const image = entry.gicon ? new Gtk.Image({gicon: entry.gicon}) : new Gtk.Image({icon_name: entry.iconName});
    // Icons only: the count sits over the icon's top-right corner.
    const icon = new Gtk.Overlay({child: image});
    const badge = new Gtk.Label({css_classes: ['sourceglance-sidebar-badge'], visible: false, can_target: false,
        halign: Gtk.Align.END, valign: Gtk.Align.START});
    icon.add_overlay(badge);
    box.append(icon);
    const title = new Gtk.Label({label: entry.title, xalign: 0, hexpand: true});
    box.append(title);
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
    let narrow = false;
    let text = '';
    const show = () => {
        title.visible = !narrow;
        count.visible = !narrow && text !== '';
        badge.visible = narrow && text !== '';
        if (row._expander)
            row._expander.visible = !narrow;
        box.halign = narrow ? Gtk.Align.CENTER : Gtk.Align.FILL;
        icon[narrow ? 'add_css_class' : 'remove_css_class']('sourceglance-sidebar-icon');
        row.tooltip_text = narrow ? entry.title : null;
    };
    row._setCount = value => {
        text = value;
        count.label = value;
        badge.label = value;
        show();
    };
    row._setNarrow = value => {
        narrow = value;
        if (entry.indent || entry.parent)
            row[narrow ? 'remove_css_class' : 'add_css_class']('sourceglance-indent');
        show();
    };
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
 * @param {boolean} [params.narrow] start with the sidebar showing icons only
 * @param {Function} [params.onNarrowChanged] called with whether it shows icons only
 * @param {Function} [params.onQuit] the Quit button at the sidebar's foot
 * @returns {{setCount(id: string, text: string): void, setSubtitle(text: string): void,
 *   select(id: string): void, current(): string|null, showPanel(params: object): void,
 *   hidePanel(): void, isPanelFor(owner: string): boolean}}
 */
export function buildMainWindow(window, {appIcon, overlay, entries, headerStart = null, headerEnd = null,
    onPageChanged = null, narrow = false, onNarrowChanged = null, onQuit = null}) {
    const list = new Gtk.ListBox({css_classes: ['navigation-sidebar', 'sourceglance-sidebar']});
    const stack = new Gtk.Stack({transition_type: Gtk.StackTransitionType.CROSSFADE});
    const rows = new Map();
    const headings = [];

    for (const entry of entries) {
        if (entry.heading) {
            const row = headingRow(entry.heading, entry.sub ? 'sourceglance-sidebar-subheading' : 'sourceglance-sidebar-heading');
            headings.push(row);
            list.append(row);
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
    // ☰ switches the sidebar between icons only and icons with names and counts.
    const hamburger = new Gtk.Button({icon_name: 'open-menu-symbolic', css_classes: ['flat']});
    sidebarHeader.pack_end(hamburger);
    const sidebarView = new Adw.ToolbarView({
        content: new Gtk.ScrolledWindow({child: list, hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true}),
    });
    sidebarView.add_top_bar(sidebarHeader);
    // Quit, at the foot of the sidebar.
    const quitLabel = new Gtk.Label({label: _('Quit'), xalign: 0, hexpand: true});
    const quitContent = new Gtk.Box({spacing: 12});
    quitContent.append(new Gtk.Image({icon_name: 'application-exit-symbolic'}));
    quitContent.append(quitLabel);
    const quit = new Gtk.Button({child: quitContent, css_classes: ['flat', 'sourceglance-sidebar-quit'],
        margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6});
    quit.update_property([Gtk.AccessibleProperty.LABEL], [_('Quit')]);
    quit.connect('clicked', () => (onQuit ? onQuit() : window.close()));
    sidebarView.add_bottom_bar(quit);
    const sidebarPage = new Adw.NavigationPage({title: 'Source Glance', child: sidebarView});

    // A panel docked on the right of the page (e.g. an item's preview): beside the list, not
    // over it, shown and hidden at once. Drag the divider to resize it.
    const panelTitle = new Adw.WindowTitle();
    const panelClose = new Gtk.Button({icon_name: 'window-close-symbolic', tooltip_text: _('Close'),
        css_classes: ['flat'], valign: Gtk.Align.CENTER});
    const panelHead = new Gtk.CenterBox({center_widget: panelTitle, end_widget: panelClose,
        css_classes: ['sourceglance-panel-head']});
    const panelBody = new Adw.Bin({vexpand: true});
    const panel = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, visible: false, width_request: 320,
        css_classes: ['sourceglance-panel']});
    panel.append(panelHead);
    panel.append(new Gtk.Separator());
    panel.append(panelBody);
    const paned = new Gtk.Paned({start_child: stack, end_child: panel, resize_start_child: true,
        resize_end_child: true, shrink_start_child: false, shrink_end_child: false, wide_handle: false});
    let panelOwner = null;
    const hidePanel = () => {
        panel.visible = false;
        panelBody.child = null;
        panelOwner = null;
    };
    panelClose.connect('clicked', hidePanel);

    const contentView = new Adw.ToolbarView({content: paned});
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

    const setNarrow = value => {
        narrow = value;
        split.min_sidebar_width = narrow ? NARROW_WIDTH : WIDE_WIDTH[0];
        split.max_sidebar_width = narrow ? NARROW_WIDTH : WIDE_WIDTH[1];
        sidebarHeader.show_title = !narrow;
        list[narrow ? 'add_css_class' : 'remove_css_class']('sourceglance-sidebar-narrow');
        for (const row of [...headings, ...rows.values()])
            row._setNarrow(narrow);
        quitLabel.visible = !narrow;
        quitContent.halign = narrow ? Gtk.Align.CENTER : Gtk.Align.FILL;
        quit.tooltip_text = narrow ? _('Quit') : null;
        hamburger.tooltip_text = narrow ? _('Show names') : _('Show icons only');
        hamburger.update_property([Gtk.AccessibleProperty.LABEL], [hamburger.tooltip_text]);
    };
    setNarrow(narrow);
    hamburger.connect('clicked', () => {
        setNarrow(!narrow);
        onNarrowChanged?.(narrow);
    });
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
            row?._setCount(text);
        },
        setSubtitle(text) {
            windowTitle.subtitle = text;
        },
        select,
        /**
         * Shows `child` in the right panel under `title` (and `subtitle`). `owner` tells who
         * has it now, e.g. an item's key; isPanelFor() checks it.
         */
        showPanel({title, subtitle = '', child, owner = null}) {
            panelTitle.title = title;
            panelTitle.subtitle = subtitle;
            panelBody.child = child;
            panelOwner = owner;
            if (!panel.visible) {
                panel.visible = true;
                const width = paned.get_width();
                // Half the page, so a wide window gives the preview room; the list keeps 360px.
                if (width > 0)
                    paned.position = Math.max(360, Math.round(width * 0.5));
            }
        },
        hidePanel,
        isPanelFor: owner => panel.visible && panelOwner === owner,
    };
}
