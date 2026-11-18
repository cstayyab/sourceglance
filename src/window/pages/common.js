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
 * count (e.g. comments) on its top-right corner; 0 shows none. `toggle` makes it a toggle button
 * (`active` its state); `onClick` gets the button. Returns {widget, button}.
 */
function iconButtonParts({iconName = null, gicon = null, tooltip, badge = 0, toggle = false, active = false, onClick}) {
    const image = gicon ? new Gtk.Image({gicon}) : new Gtk.Image({icon_name: iconName});
    const Button = toggle ? Gtk.ToggleButton : Gtk.Button;
    const button = new Button({child: image, tooltip_text: tooltip, valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'sourceglance-icon-action'], ...toggle ? {active} : {}});
    button.update_property([Gtk.AccessibleProperty.LABEL], [badge > 0 ? `${tooltip} (${badge})` : tooltip]);
    button.connect(toggle ? 'toggled' : 'clicked', () => onClick(button));
    if (badge <= 0)
        return {widget: button, button};
    // The badge sits over the button's corner; clicks on it go to the button.
    const overlay = new Gtk.Overlay({child: button, valign: Gtk.Align.CENTER});
    overlay.add_overlay(new Gtk.Label({label: badge > 99 ? '99+' : String(badge), css_classes: ['sourceglance-badge'],
        halign: Gtk.Align.END, valign: Gtk.Align.START, can_target: false}));
    return {widget: overlay, button};
}

/** An icon-only button for an item's title line (see iconButtonParts()). */
export function iconButton(params) {
    return iconButtonParts(params).widget;
}

/**
 * The (⋮) button at the end of an item's title line: a menu of `items`, each
 * {label, iconName or gicon, onClick}.
 */
export function moreButton(items) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2});
    const popover = new Gtk.Popover({child: box, css_classes: ['menu']});
    for (const item of items) {
        const content = new Gtk.Box({spacing: 10});
        content.append(item.gicon ? new Gtk.Image({gicon: item.gicon}) : new Gtk.Image({icon_name: item.iconName}));
        content.append(new Gtk.Label({label: item.label, xalign: 0, hexpand: true}));
        const button = new Gtk.Button({child: content, css_classes: ['flat', 'sourceglance-menu-item']});
        button.connect('clicked', () => {
            popover.popdown();
            item.onClick();
        });
        box.append(button);
    }
    const menu = new Gtk.MenuButton({icon_name: 'view-more-symbolic', tooltip_text: _('More actions'), popover,
        valign: Gtk.Align.CENTER, css_classes: ['flat', 'sourceglance-icon-action'], sensitive: items.length > 0});
    menu.update_property([Gtk.AccessibleProperty.LABEL], [_('More actions')]);
    return menu;
}

/**
 * The scrolling body of a list page: its groups stacked from the left, full width. Has add()
 * and remove() like Adw.PreferencesPage, which would centre them.
 */
export class ListBody {
    constructor() {
        this._box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 24,
            margin_top: 6, margin_bottom: 24, margin_start: 12, margin_end: 12});
        this.widget = new Gtk.ScrolledWindow({child: this._box, hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true});
    }

    add(group) {
        this._box.append(group);
    }

    remove(group) {
        this._box.remove(group);
    }
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
 * A list row: an arrow, icon, title, `buttons` and a (⋮) menu of `menu` items on the first line,
 * then `lines` (chip lines) under the title, shown or hidden by the arrow. `expanded` is whether
 * they show; `onExpand(bool)` keeps it. `footer` (e.g. a comment box) goes last. Clicking the
 * title runs `onTitleClick`. `busy` dims the controls and says so.
 */
export function itemRow({prefix, title, subtitle = '', buttons, menu = [], lines = [], footer = null, busy,
    expanded = false, onExpand = null, onTitleClick = null}) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6,
        margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6});
    const top = new Gtk.Box({spacing: 6});
    box.append(top);
    prefix.valign = Gtk.Align.CENTER;
    const text = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true, valign: Gtk.Align.CENTER});
    const titleLabel = new Gtk.Label({label: title, xalign: 0, ellipsize: 3 /* END */, css_classes: ['heading'],
        tooltip_text: title});
    if (onTitleClick) {
        titleLabel.add_css_class('sourceglance-item-title');
        titleLabel.set_cursor_from_name('pointer');
        const click = new Gtk.GestureClick();
        click.connect('released', () => onTitleClick());
        titleLabel.add_controller(click);
    }
    text.append(titleLabel);
    if (busy || subtitle) {
        text.append(new Gtk.Label({label: busy ? _('Working…') : subtitle, xalign: 0, ellipsize: 3 /* END */,
            css_classes: ['dim-label', 'caption']}));
    }
    const actions = new Gtk.Box({spacing: 0, sensitive: !busy, valign: Gtk.Align.CENTER});
    for (const button of buttons)
        actions.append(button);
    actions.append(moreButton(menu));

    // The arrow leads the row; without chips, a gap of its size keeps the icons in line.
    const arrow = new Gtk.Button({valign: Gtk.Align.CENTER, css_classes: ['flat', 'sourceglance-expander']});
    top.append(lines.length > 0 ? arrow : new Gtk.Box({width_request: 24}));
    top.append(prefix);
    top.append(text);
    top.append(actions);
    const row = new Adw.PreferencesRow({child: box, activatable: false, title});
    if (lines.length > 0) {
        const chips = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_top: 2});
        for (const line of lines) {
            // Chips start under the title, past the arrow and the icon.
            line.margin_start = 52;
            line.sensitive = !busy;
            chips.append(line);
        }
        const revealer = new Gtk.Revealer({child: chips, reveal_child: expanded,
            transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN});
        box.append(revealer);
        const show = open => {
            arrow.icon_name = open ? 'pan-down-symbolic' : 'pan-end-symbolic';
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
    }
    if (footer) {
        footer.margin_start = 52;
        box.append(footer);
    }
    return row;
}

/** Copies `text` to the clipboard and says so. */
function copy(actions, text, done) {
    Gdk.Display.get_default().get_clipboard().set_content(Gdk.ContentProvider.new_for_value(text));
    actions.notify(done);
}

/**
 * An issue or pull request: Preview, Comment (with its count), Close, a button per board it's
 * on, Open in the browser and a (⋮) menu on the title line, then its labels and assignees as
 * chips. Comment shows a comment box under the item, which goes again on Cancel or once posted.
 * `context` leads the subtitle, e.g. the repository where the list doesn't group by it.
 */
export function issueRow({item, busy, icons, actions, context = ''}) {
    const parts = context ? [context] : [];
    if (item.kind === 'pr' && item.reason === 'review')
        parts.push(_('review requested'));
    for (const board of item.boards ?? [])
        parts.push(`${board.title}: ${board.status ?? _('No status')}`);

    const composer = new Gtk.Revealer({transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN,
        reveal_child: actions.isCommenting(item)});
    const comment = iconButtonParts({iconName: 'chat-message-new-symbolic', tooltip: _('Comment'),
        badge: item.comments ?? 0, toggle: true, active: actions.isCommenting(item),
        onClick: button => {
            actions.setCommenting(item, button.active);
            box ??= actions.commentBox(item, () => (button.active = false));
            composer.child = box.widget;
            composer.reveal_child = button.active;
            if (button.active)
                box.focus();
        }});
    // The box comes back after a refresh rebuilds the row, with what was typed in it.
    let box = null;
    if (actions.isCommenting(item)) {
        box = actions.commentBox(item, () => (comment.button.active = false));
        composer.child = box.widget;
    }

    const buttons = [
        iconButton({iconName: 'view-reveal-symbolic', tooltip: _('Preview'), onClick: () => actions.preview(item)}),
        comment.widget,
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
    const menu = [
        {label: _('Labels…'), gicon: icons.label, onClick: () => actions.labels(item)},
        {label: _('Assignees…'), iconName: 'system-users-symbolic', onClick: () => actions.assignees(item)},
        {label: _('Copy reference'), iconName: 'edit-copy-symbolic',
            onClick: () => copy(actions, `${item.repo}${itemRef(item)}`, _('Reference copied'))},
    ];
    if (item.url) {
        menu.push({label: _('Copy link'), iconName: 'edit-copy-symbolic',
            onClick: () => copy(actions, item.url, _('Link copied'))});
    }
    return itemRow({
        prefix: new Gtk.Image({gicon: item.kind === 'pr' ? icons.pr : icons.issue,
            css_classes: [item.kind === 'pr' ? 'sourceglance-kind-pr' : 'sourceglance-kind-issue']}),
        title: `${itemRef(item)}  ${item.title}`,
        subtitle: parts.join('  ·  '),
        buttons,
        menu,
        lines: [actions.labelLine(item), actions.assigneeLine(item)],
        footer: composer,
        busy,
        expanded: actions.isExpanded(item),
        onExpand: open => actions.setExpanded(item, open),
        onTitleClick: () => actions.preview(item),
    });
}

/**
 * A project draft: Preview, Move to status, Open board and a (⋮) menu on the title line, then its
 * assignees as chips. GitHub drafts have no labels, comments or close. `busyKeys` is the state's
 * busy list.
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
    const menu = [{label: _('Copy title'), iconName: 'edit-copy-symbolic',
        onClick: () => copy(actions, draft.title ?? '', _('Title copied'))}];
    if (board.url) {
        menu.push({label: _('Copy board link'), iconName: 'edit-copy-symbolic',
            onClick: () => copy(actions, board.url, _('Link copied'))});
    }
    const status = draft.status ?? _('No status');
    const done = isDoneStatus(draft.status);
    return itemRow({
        prefix: done
            ? new Gtk.Image({gicon: icons.issueClosed, css_classes: ['sourceglance-kind-done']})
            : new Gtk.Image({icon_name: 'document-edit-symbolic', css_classes: ['sourceglance-kind-draft']}),
        title: draft.title || _('Untitled draft'),
        subtitle: context ? `${context}  ·  ${status}` : status,
        buttons,
        menu,
        lines: item.draftId ? [actions.assigneeLine(item)] : [],
        busy: busyKeys.includes(itemKey(item)),
        expanded: actions.isExpanded(item),
        onExpand: open => actions.setExpanded(item, open),
        onTitleClick: item.draftId ? () => actions.preview(item) : null,
    });
}
