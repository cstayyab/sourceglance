// The row of tabs at the top of the menu in the "tabs" layout.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/**
 * `tabs` is [{id, gicon, name, badge}]. Clicking a tab calls onSelect(id); the menu stays
 * open because the row itself is never activated.
 */
export const TabBar = GObject.registerClass(
class TabBar extends PopupMenu.PopupBaseMenuItem {
    _init({tabs, selected, onSelect}) {
        super._init({reactive: false, can_focus: false, style_class: 'sourceglance-tabbar'});
        const row = new St.BoxLayout({x_expand: true, style_class: 'sourceglance-tabs'});
        for (const tab of tabs) {
            const content = new St.BoxLayout({style_class: 'sourceglance-tab-content'});
            content.add_child(new St.Icon({gicon: tab.gicon, style_class: 'popup-menu-icon'}));
            if (tab.badge) {
                content.add_child(new St.Label({
                    text: tab.badge,
                    style_class: 'sourceglance-count',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }
            const button = new St.Button({
                child: content,
                style_class: 'sourceglance-tab',
                can_focus: true,
                x_expand: true,
                accessible_name: tab.name,
            });
            if (tab.id === selected)
                button.add_style_pseudo_class('checked');
            button.connect('clicked', () => onSelect(tab.id));
            row.add_child(button);
        }
        this.add_child(row);
    }
});
