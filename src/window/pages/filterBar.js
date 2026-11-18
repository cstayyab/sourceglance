// The filter bar above a list: a button per kind of filter (Kind, Accounts, Labels,
// Assignee), each a check list with counts, then what's checked as chips on a row of their
// own, each with × to remove it, and Clear filters. All Tasks shows all four; the lists by
// kind show Labels and Assignee (their accounts and kinds are already sections and pages).
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {taskFilterGroups, toggleTaskFilter} from '../../lib/model.js';

function kindTitle(kind) {
    return {issue: _('Issues'), pr: _('Pull requests'), draft: _('Projects')}[kind];
}

function typeTitle(type) {
    return {kind: _('Kind'), account: _('Accounts'), label: _('Labels'), assignee: _('Assignee')}[type];
}

function typeTooltip(type) {
    return {
        kind: _('Show issues, pull requests or project drafts'),
        account: _('Show what one of your accounts has'),
        label: _('Show items with a label'),
        assignee: _('Show items assigned to someone'),
    }[type];
}

/** The chip's kind of filter, before its name. */
function chipType(type) {
    return {kind: _('Kind'), account: _('Account'), label: _('Label'), assignee: _('Assignee')}[type];
}

export class FilterBar {
    /** `types` are the buttons, in order; `onChange` runs after the filters change. */
    constructor({types, onChange}) {
        this._types = types;
        this._onChange = onChange;
        // Active filters, in the order added: [{type, value, title}].
        this.filters = [];

        const buttons = new Gtk.Box({spacing: 6});
        this._menus = {};
        for (const type of types) {
            const count = new Gtk.Label({css_classes: ['sourceglance-filter-count'], valign: Gtk.Align.CENTER, visible: false});
            const content = new Gtk.Box({spacing: 6});
            content.append(new Gtk.Label({label: typeTitle(type)}));
            content.append(count);
            const menu = new Gtk.MenuButton({child: content, always_show_arrow: true, css_classes: ['flat'],
                tooltip_text: typeTooltip(type), popover: new Gtk.Popover()});
            this._menus[type] = {menu, count};
            buttons.append(menu);
        }
        this._chipBox = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, column_spacing: 6, row_spacing: 6,
            max_children_per_line: 30, hexpand: true});
        const clear = new Gtk.Button({label: _('Clear filters'), css_classes: ['flat'], valign: Gtk.Align.START});
        clear.connect('clicked', () => this._set([]));
        this._chipRow = new Gtk.Box({spacing: 6, visible: false});
        this._chipRow.append(this._chipBox);
        this._chipRow.append(clear);
        const bar = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_top: 12, margin_bottom: 6,
            margin_start: 12, margin_end: 12, css_classes: ['sourceglance-filter-bar']});
        bar.append(buttons);
        bar.append(this._chipRow);
        this.widget = new Adw.Clamp({child: bar, maximum_size: 800});
    }

    /**
     * Refreshes the check lists and chips for `tasks` (see allTasks() in model.js; items and
     * drafts wrapped the same way). Filters whose choice is gone (an account signed out, a
     * label no item has any more) are dropped.
     */
    update(tasks, sources) {
        const groups = taskFilterGroups(tasks, sources, this.filters);
        this.filters = this.filters.filter(filter => groups[filter.type]?.some(option => option.value === filter.value));

        for (let child = this._chipBox.get_first_child(); child;) {
            const next = child.get_next_sibling();
            this._chipBox.remove(child);
            child = next;
        }
        for (const filter of this.filters) {
            const title = filter.type === 'kind' ? kindTitle(filter.value) : filter.title;
            const chip = new Gtk.Box({spacing: 4, css_classes: ['sourceglance-chip'], valign: Gtk.Align.CENTER});
            chip.append(new Gtk.Label({label: chipType(filter.type), css_classes: ['dim-label']}));
            chip.append(new Gtk.Label({label: title, ellipsize: 3 /* END */, max_width_chars: 24}));
            const remove = new Gtk.Button({icon_name: 'window-close-symbolic', tooltip_text: _('Remove this filter'),
                css_classes: ['flat', 'sourceglance-chip-remove'], valign: Gtk.Align.CENTER});
            remove.update_property([Gtk.AccessibleProperty.LABEL], [_('Remove the filter %s').format(title)]);
            remove.connect('clicked', () => this._set(this.filters.filter(other => other !== filter)));
            chip.append(remove);
            this._chipBox.append(chip);
        }
        this._chipRow.visible = this.filters.length > 0;

        for (const type of this._types) {
            const {menu, count} = this._menus[type];
            const options = groups[type];
            const checked = options.filter(option => option.active).length;
            count.label = String(checked);
            count.visible = checked > 0;
            menu.sensitive = options.length > 0;
            const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2,
                margin_top: 4, margin_bottom: 4, margin_start: 4, margin_end: 4});
            for (const option of options) {
                const title = type === 'kind' ? kindTitle(option.value) : option.title;
                const line = new Gtk.Box({spacing: 12});
                line.append(new Gtk.Label({label: title, xalign: 0, hexpand: true, ellipsize: 3 /* END */, max_width_chars: 32}));
                line.append(new Gtk.Label({label: String(option.count), css_classes: ['dim-label', 'numeric']}));
                const check = new Gtk.CheckButton({child: line, active: option.active});
                check.connect('toggled', () => {
                    // Rebuild after the signal; the popover stays open for more checks.
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        this._set(toggleTaskFilter(this.filters, {type, value: option.value, title}));
                        return GLib.SOURCE_REMOVE;
                    });
                });
                list.append(check);
            }
            menu.popover.child = options.length > 8
                ? new Gtk.ScrolledWindow({child: list, hscrollbar_policy: Gtk.PolicyType.NEVER,
                    propagate_natural_height: true, max_content_height: 360})
                : list;
        }
    }

    _set(filters) {
        this.filters = filters;
        this._onChange();
    }
}
