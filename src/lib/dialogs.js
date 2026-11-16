// Modal dialogs for menu actions. All text from GitHub is set as plain text, never markup.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {CheckBox} from 'resource:///org/gnome/shell/ui/checkBox.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {MAX_COMMENT_LENGTH, gtypeName, itemRef, truncate} from './model.js';
import {closeReasons} from './requests.js';

// GNOME 48 replaced St.BoxLayout's `vertical` with `orientation`.
function verticalBox(params) {
    const box = new St.BoxLayout(params);
    if ('orientation' in box)
        box.orientation = Clutter.Orientation.VERTICAL;
    else
        box.vertical = true;
    return box;
}

function setSensitive(button, sensitive) {
    button.reactive = sensitive;
    button.can_focus = sensitive;
    if (sensitive)
        button.remove_style_pseudo_class('insensitive');
    else
        button.add_style_pseudo_class('insensitive');
}

function itemHeading(item) {
    if (item.kind !== 'pr')
        return _('Issue %s in %s').format(itemRef(item), item.repo);
    return item.platform === 'gitlab'
        ? _('Merge request %s in %s').format(itemRef(item), item.repo)
        : _('Pull request %s in %s').format(itemRef(item), item.repo);
}

/** Comment box. Calls onSubmit(text) with the text as typed; model.js validates it. */
export const CommentDialog = GObject.registerClass({GTypeName: gtypeName('CommentDialog', import.meta.url)},
class CommentDialog extends ModalDialog.ModalDialog {
    _init(item, onSubmit) {
        super._init({styleClass: 'sourceglance-dialog'});

        this.contentLayout.add_child(new Dialog.MessageDialogContent({
            title: itemHeading(item),
            description: truncate(item.title, 120),
        }));

        this._entry = new St.Entry({
            style_class: 'sourceglance-comment-entry',
            hint_text: _('Write a comment'),
            can_focus: true,
            x_expand: true,
        });
        const text = this._entry.clutter_text;
        text.single_line_mode = false;
        text.activatable = false;
        text.line_wrap = true;
        text.max_length = MAX_COMMENT_LENGTH;
        this.contentLayout.add_child(this._entry);

        this.addButton({label: _('Cancel'), action: () => this.close(), key: Clutter.KEY_Escape});
        const post = this.addButton({
            label: _('Post comment'),
            action: () => {
                if (!text.text.trim())
                    return;
                this.close();
                onSubmit(text.text);
            },
        });
        setSensitive(post, false);
        text.connect('text-changed', () => setSensitive(post, text.text.trim().length > 0));
        this.setInitialKeyFocus(text);
    }
});

function closeTitle(item) {
    const ref = itemRef(item);
    if (item.kind !== 'pr')
        return _('Close issue %s?').format(ref);
    return item.platform === 'gitlab' ? _('Close merge request %s?').format(ref) : _('Close pull request %s?').format(ref);
}

function closeButtonLabel(item) {
    if (item.kind !== 'pr')
        return _('Close issue');
    return item.platform === 'gitlab' ? _('Close merge request') : _('Close pull request');
}

/** Close confirmation. Calls onConfirm(reason): one of closeReasons(item). */
export const CloseDialog = GObject.registerClass({GTypeName: gtypeName('CloseDialog', import.meta.url)},
class CloseDialog extends ModalDialog.ModalDialog {
    _init(item, onConfirm) {
        super._init({styleClass: 'sourceglance-dialog'});

        this.contentLayout.add_child(new Dialog.MessageDialogContent({
            title: closeTitle(item),
            description: `${truncate(item.title, 120)}\n${item.repo}`,
        }));

        const choose = reason => {
            this.close();
            onConfirm(reason);
        };
        this.addButton({label: _('Cancel'), action: () => this.close(), key: Clutter.KEY_Escape});
        // GitHub issues can be closed as completed or not planned; everything else just closes.
        const labels = {not_planned: _('Close as not planned'), completed: _('Close as completed'), close: closeButtonLabel(item)};
        for (const reason of closeReasons(item))
            this.addButton({label: labels[reason], action: () => choose(reason)});
    }
});

/**
 * A checkbox list. `options` is [{id, label}], `selected` the ids checked at first. With
 * single: true at most one box stays checked. Calls onApply(selectedIds).
 */
export const PickerDialog = GObject.registerClass({GTypeName: gtypeName('PickerDialog', import.meta.url)},
class PickerDialog extends ModalDialog.ModalDialog {
    _init({title, description, options, selected, single = false, emptyText, onApply}) {
        super._init({styleClass: 'sourceglance-dialog'});

        this.contentLayout.add_child(new Dialog.MessageDialogContent({title, description}));

        const list = verticalBox({style_class: 'sourceglance-picker-list', x_expand: true});
        const boxes = [];
        for (const option of options) {
            const box = new CheckBox(option.label);
            box.checked = selected.includes(option.id);
            box.connect('notify::checked', () => {
                if (single && box.checked) {
                    for (const other of boxes) {
                        if (other.box !== box)
                            other.box.checked = false;
                    }
                }
            });
            boxes.push({id: option.id, box});
            list.add_child(box);
        }
        if (options.length === 0)
            list.add_child(new St.Label({text: emptyText, style_class: 'sourceglance-picker-empty'}));

        this.contentLayout.add_child(new St.ScrollView({
            style_class: 'sourceglance-picker',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            child: list,
        }));

        this.addButton({label: _('Cancel'), action: () => this.close(), key: Clutter.KEY_Escape});
        const apply = this.addButton({
            label: _('Apply'),
            action: () => {
                this.close();
                onApply(boxes.filter(entry => entry.box.checked).map(entry => entry.id));
            },
        });
        setSensitive(apply, options.length > 0);
        if (boxes.length > 0)
            this.setInitialKeyFocus(boxes[0].box);
    }
});
