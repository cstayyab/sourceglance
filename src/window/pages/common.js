// Small pieces shared by the window's list pages.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {draftTarget, isDoneStatus, itemKey, itemRef, labelTextColor} from '../../lib/model.js';

/**
 * A flat button with an icon (theme name or Gio.Icon) and a label. `badge` is an optional
 * count shown after the label (e.g. comments); 0 shows none.
 */
export function actionButton({iconName = null, gicon = null, label, badge = 0, onClick}) {
    const box = new Gtk.Box({spacing: 6});
    box.append(gicon ? new Gtk.Image({gicon}) : new Gtk.Image({icon_name: iconName}));
    box.append(new Gtk.Label({label, ellipsize: 3 /* END */, max_width_chars: 28}));
    if (badge > 0)
        box.append(new Gtk.Label({label: String(badge), css_classes: ['sourceglance-count-pill'], valign: Gtk.Align.CENTER}));
    const button = new Gtk.Button({child: box, css_classes: ['sourceglance-action'], valign: Gtk.Align.CENTER});
    button.connect('clicked', onClick);
    return button;
}

/**
 * A flat icon-only button for an item's title line; `tooltip` names it. `badge` is an optional
 * count (e.g. comments) on its top-right corner; 0 shows none.
 */
export function iconButton({iconName = null, gicon = null, tooltip, badge = 0, onClick}) {
    const image = gicon ? new Gtk.Image({gicon}) : new Gtk.Image({icon_name: iconName});
    const button = new Gtk.Button({child: image, tooltip_text: tooltip, valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'sourceglance-icon-action']});
    button.update_property([Gtk.AccessibleProperty.LABEL], [badge > 0 ? `${tooltip} (${badge})` : tooltip]);
    button.connect('clicked', onClick);
    if (badge <= 0)
        return button;
    // The badge sits over the button's corner; clicks on it go to the button.
    const overlay = new Gtk.Overlay({child: button, valign: Gtk.Align.CENTER});
    overlay.add_overlay(new Gtk.Label({label: badge > 99 ? '99+' : String(badge), css_classes: ['sourceglance-badge'],
        halign: Gtk.Align.END, valign: Gtk.Align.START, can_target: false}));
    return overlay;
}

/**
 * What to show instead of a list: {icon, title, description}, or null when the list can
 * show (loaded, possibly with a stale error).
 */
export function statusText(state) {
    if (state.status === 'signed-out') {
        return {icon: 'avatar-default-symbolic', title: _('Not signed in'),
            description: _('Sign in under Settings → Accounts.')};
    }
    if (state.updatedAt === null && state.status !== 'error')
        return {icon: 'content-loading-symbolic', title: _('Loading…'), description: ''};
    if (state.updatedAt === null && state.status === 'error') {
        return {icon: 'network-error-symbolic', title: _('Couldn’t load your lists'),
            description: state.error?.kind === 'network'
                ? _('Couldn’t reach GitHub. Check your connection.')
                : _('GitHub returned an error. Source Glance will try again soon.')};
    }
    return null;
}

/** "Nothing matches" for a search, with a button that clears it to show the full list again. */
export function noMatchesGroup(query, onClear) {
    const group = new Adw.PreferencesGroup();
    const row = new Adw.ActionRow({title: _('Nothing matches “%s”').format(query), use_markup: false});
    row.add_prefix(new Gtk.Image({icon_name: 'edit-find-symbolic'}));
    const clear = new Gtk.Button({label: _('Clear search'), valign: Gtk.Align.CENTER});
    clear.connect('clicked', onClear);
    row.add_suffix(clear);
    group.add(row);
    return group;
}

/**
 * A group whose heading (disclosure arrow, title, item count) collapses or expands it. The
 * caller adds the rows only when not `collapsed`. `toggleable` is false while a search expands
 * every group; `suffix` is an optional widget after the heading (e.g. Open board). `onToggle`
 * runs after the click's signal, since the caller usually rebuilds the page.
 */
export function collapsibleGroup({title, count, collapsed, toggleable = true, suffix = null, onToggle}) {
    const group = new Adw.PreferencesGroup();
    const heading = new Gtk.Box({spacing: 6});
    heading.append(new Gtk.Image({icon_name: collapsed ? 'pan-end-symbolic' : 'pan-down-symbolic'}));
    heading.append(new Gtk.Label({label: title, xalign: 0, hexpand: true, ellipsize: 3 /* END */,
        css_classes: ['heading']}));
    heading.append(new Gtk.Label({label: String(count), css_classes: ['sourceglance-count-pill'], valign: Gtk.Align.CENTER}));
    const toggle = new Gtk.Button({child: heading, hexpand: true, sensitive: toggleable,
        css_classes: ['flat', 'sourceglance-group-toggle'],
        tooltip_text: !toggleable ? _('Clear the search to collapse') : collapsed ? _('Show') : _('Hide')});
    toggle.update_property([Gtk.AccessibleProperty.LABEL], [title]);
    // GJS passes this state as an int, not a boolean.
    toggle.update_state([Gtk.AccessibleState.EXPANDED], [collapsed ? 0 : 1]);
    toggle.connect('clicked', () => {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            onToggle();
            return GLib.SOURCE_REMOVE;
        });
    });
    if (suffix) {
        const box = new Gtk.Box({spacing: 6, hexpand: true});
        box.append(toggle);
        box.append(suffix);
        group.set_header_suffix(box);
    } else {
        group.set_header_suffix(toggle);
    }
    return group;
}

// Label colours come from the API, so each one gets a generated class. Colours are checked
// ("rrggbb") before they reach the CSS.
const labelProvider = new Gtk.CssProvider();
const labelColors = new Set();
let labelProviderAdded = false;

/** The CSS class that paints a label of colour `color` ("rrggbb"), or null for none. */
export function labelClass(color) {
    const text = labelTextColor(color);
    if (!text)
        return null;
    const name = `sourceglance-label-${color}`;
    if (!labelColors.has(color)) {
        labelColors.add(color);
        const css = [...labelColors].map(c =>
            `.sourceglance-window .sourceglance-label-${c} { background-color: #${c}; color: ${labelTextColor(c)}; }`).join('\n');
        if (labelProvider.load_from_string)
            labelProvider.load_from_string(css);
        else
            labelProvider.load_from_data(css, -1);
        if (!labelProviderAdded) {
            Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), labelProvider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
            labelProviderAdded = true;
        }
    }
    return name;
}

/**
 * A chip: a label (in its colour) or a person, with an (x) that runs `onRemove`. A null
 * `color` gets the neutral chip.
 */
export function chip({text, color = null, removeTooltip, onRemove}) {
    const box = new Gtk.Box({spacing: 2, css_classes: ['sourceglance-item-chip'], valign: Gtk.Align.CENTER});
    const colorClass = color ? labelClass(color) : null;
    if (colorClass)
        box.add_css_class(colorClass);
    box.append(new Gtk.Label({label: text, ellipsize: 3 /* END */, max_width_chars: 30}));
    const remove = new Gtk.Button({icon_name: 'window-close-symbolic', tooltip_text: removeTooltip,
        css_classes: ['flat', 'sourceglance-item-chip-remove'], valign: Gtk.Align.CENTER});
    remove.update_property([Gtk.AccessibleProperty.LABEL], [removeTooltip]);
    remove.connect('clicked', onRemove);
    box.append(remove);
    return box;
}

/** The (+) chip at the end of a chip line. `onClick` gets the button, to anchor a popover. */
export function addChip({label, tooltip, onClick}) {
    const box = new Gtk.Box({spacing: 4});
    box.append(new Gtk.Image({icon_name: 'list-add-symbolic'}));
    box.append(new Gtk.Label({label}));
    const button = new Gtk.Button({child: box, tooltip_text: tooltip, css_classes: ['flat', 'sourceglance-item-chip-add'],
        valign: Gtk.Align.CENTER});
    button.connect('clicked', () => onClick(button));
    return button;
}

/** A wrapping line of chips with a leading icon (Gio.Icon or theme name) and its accessible name. */
export function chipLine({gicon = null, iconName = null, name, chips}) {
    const line = new Gtk.Box({spacing: 8});
    const icon = gicon ? new Gtk.Image({gicon}) : new Gtk.Image({icon_name: iconName});
    icon.add_css_class('dim-label');
    icon.valign = Gtk.Align.START;
    icon.margin_top = 5;
    icon.tooltip_text = name;
    line.append(icon);
    const flow = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, column_spacing: 6, row_spacing: 4,
        max_children_per_line: 20, hexpand: true, homogeneous: false});
    flow.update_property([Gtk.AccessibleProperty.LABEL], [name]);
    for (const child of chips)
        flow.append(child);
    line.append(flow);
    return line;
}

/**
 * A list row: icon, title and `buttons` on the first line, then `lines` (chip lines) under the
 * title, shown or hidden by an arrow at the end of the buttons. `expanded` is whether they
 * show; `onExpand(bool)` keeps it. `busy` dims the controls and says so.
 */
export function itemRow({prefix, title, subtitle = '', buttons, lines = [], busy, expanded = false, onExpand = null}) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6,
        margin_top: 8, margin_bottom: 8, margin_start: 12, margin_end: 12});
    const top = new Gtk.Box({spacing: 10});
    prefix.valign = Gtk.Align.CENTER;
    top.append(prefix);
    const text = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true, valign: Gtk.Align.CENTER});
    text.append(new Gtk.Label({label: title, xalign: 0, ellipsize: 3 /* END */, css_classes: ['heading'],
        tooltip_text: title}));
    if (busy || subtitle) {
        text.append(new Gtk.Label({label: busy ? _('Working…') : subtitle, xalign: 0, ellipsize: 3 /* END */,
            css_classes: ['dim-label', 'caption']}));
    }
    top.append(text);
    const actions = new Gtk.Box({spacing: 2, sensitive: !busy, valign: Gtk.Align.CENTER});
    for (const button of buttons)
        actions.append(button);
    top.append(actions);
    box.append(top);
    if (lines.length === 0)
        return new Adw.PreferencesRow({child: box, activatable: false, title});

    const chips = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_top: 2});
    for (const line of lines) {
        // Chips start under the title, past the icon.
        line.margin_start = 26;
        line.sensitive = !busy;
        chips.append(line);
    }
    const revealer = new Gtk.Revealer({child: chips, reveal_child: expanded,
        transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN});
    box.append(revealer);
    const arrow = new Gtk.Button({valign: Gtk.Align.CENTER, css_classes: ['flat', 'sourceglance-icon-action']});
    const show = open => {
        arrow.icon_name = open ? 'pan-up-symbolic' : 'pan-down-symbolic';
        arrow.tooltip_text = open ? _('Hide labels and assignees') : _('Show labels and assignees');
        arrow.update_property([Gtk.AccessibleProperty.LABEL], [arrow.tooltip_text]);
        // GJS passes this state as an int, not a boolean.
        arrow.update_state([Gtk.AccessibleState.EXPANDED], [open ? 1 : 0]);
    };
    show(expanded);
    arrow.connect('clicked', () => {
        revealer.reveal_child = !revealer.reveal_child;
        show(revealer.reveal_child);
        onExpand?.(revealer.reveal_child);
    });
    top.append(arrow);
    const row = new Adw.PreferencesRow({child: box, activatable: false, title});
    return row;
}

/**
 * An issue or pull request: Preview, Comment (with its count), Close, a button per board it's
 * on and Open in the browser on the title line, then its labels and assignees as chips. `context`
 * leads the subtitle, e.g. the repository where the list doesn't group by it.
 */
export function issueRow({item, busy, icons, actions, context = ''}) {
    const parts = context ? [context] : [];
    if (item.kind === 'pr' && item.reason === 'review')
        parts.push(_('review requested'));
    for (const board of item.boards ?? [])
        parts.push(`${board.title}: ${board.status ?? _('No status')}`);
    const buttons = [
        iconButton({iconName: 'view-reveal-symbolic', tooltip: _('Preview'), onClick: () => actions.preview(item)}),
        iconButton({iconName: 'chat-message-new-symbolic', tooltip: _('Comment'), badge: item.comments ?? 0,
            onClick: () => actions.comment(item)}),
        iconButton({gicon: item.kind === 'pr' ? icons.prClosed : icons.issueClosed, tooltip: _('Close'),
            onClick: () => actions.close(item)}),
        ...(item.boards ?? []).map(board => iconButton({gicon: icons.projects,
            tooltip: _('Move on %s (now %s)').format(board.title, board.status ?? _('No status')),
            onClick: () => actions.status(item, board)})),
    ];
    if (item.url) {
        buttons.push(iconButton({iconName: 'adw-external-link-symbolic', tooltip: actions.openLabel(item),
            onClick: () => actions.open(item.url)}));
    }
    return itemRow({
        prefix: new Gtk.Image({gicon: item.kind === 'pr' ? icons.pr : icons.issue}),
        title: `${itemRef(item)}  ${item.title}`,
        subtitle: parts.join('  ·  '),
        buttons,
        lines: [actions.labelLine(item), actions.assigneeLine(item)],
        busy,
        expanded: actions.isExpanded(item),
        onExpand: open => actions.setExpanded(item, open),
    });
}

/**
 * A project draft: Preview, Move to status and Open board on the title line, then its assignees as
 * chips. GitHub drafts have no labels, comments or close. `busyKeys` is the state's busy list.
 */
export function draftRow({board, draft, busyKeys, icons, actions, context = ''}) {
    const {item, board: target} = draftTarget(board, draft);
    const move = iconButton({gicon: icons.projects, tooltip: _('Move to status'), onClick: () => actions.status(item, target)});
    move.sensitive = Boolean(board.fieldId) && board.options.length > 0;
    const buttons = [move];
    if (item.draftId)
        buttons.unshift(iconButton({iconName: 'view-reveal-symbolic', tooltip: _('Preview'), onClick: () => actions.preview(item)}));
    if (board.url) {
        buttons.push(iconButton({iconName: 'adw-external-link-symbolic', tooltip: _('Open board'),
            onClick: () => actions.open(board.url)}));
    }
    const status = draft.status ?? _('No status');
    return itemRow({
        prefix: isDoneStatus(draft.status)
            ? new Gtk.Image({gicon: icons.issueClosed})
            : new Gtk.Image({icon_name: 'document-edit-symbolic'}),
        title: draft.title || _('Untitled draft'),
        subtitle: context ? `${context}  ·  ${status}` : status,
        buttons,
        lines: item.draftId ? [actions.assigneeLine(item)] : [],
        busy: busyKeys.includes(itemKey(item)),
        expanded: actions.isExpanded(item),
        onExpand: open => actions.setExpanded(item, open),
    });
}
