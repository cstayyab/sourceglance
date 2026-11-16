import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, _('sourceglance'));

        this.add_child(new St.Icon({
            icon_name: 'checkbox-checked-symbolic',
            style_class: 'system-status-icon',
        }));

        // Placeholder until the GitHub client lands (see roadmap in README.md).
        const empty = new PopupMenu.PopupMenuItem(_('No issues yet'), {reactive: false});
        empty.add_style_class_name('sourceglance-empty');
        this.menu.addMenuItem(empty);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
        settingsItem.connect('activate', () => extension.openPreferences());
        this.menu.addMenuItem(settingsItem);
    }
});

export default class SourceglanceExtension extends Extension {
    enable() {
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
