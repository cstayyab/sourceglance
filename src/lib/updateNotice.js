// At login, says when a newer Source Glance is out: a notification with short release notes
// and Install, which opens the window and starts its update there (window/updateButton.js).
// Like the window's check, it only asks GitHub's public releases API; nothing about you is sent.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {isCancelled} from './github.js';
import {findUpdate, releaseNotesSummary} from './updates.js';

// Checked a little after login, once the network is up and the desktop has settled.
const DELAY_SECONDS = 20;

export class UpdateNotice {
    /**
     * `version` is the running version-name, e.g. "0.4.2"; `onInstall()` opens the window
     * and starts the update.
     */
    constructor({client, settings, version, gicon, onInstall}) {
        this._client = client;
        this._settings = settings;
        this._version = version;
        this._gicon = gicon;
        this._onInstall = onInstall;
        this._cancellable = null;
        this._source = null;
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, DELAY_SECONDS, () => {
            this._timeoutId = 0;
            this._check();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _check() {
        if (!this._settings.get_boolean('check-updates'))
            return;
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        let update;
        try {
            update = findUpdate(await this._client.listReleases(cancellable), this._version);
        } catch (e) {
            // Offline or rate-limited: the window checks again when it opens.
            if (!isCancelled(e))
                console.debug(`sourceglance: update check failed: ${e.message}`);
            return;
        } finally {
            if (this._cancellable === cancellable)
                this._cancellable = null;
        }
        if (update && !cancellable.is_cancelled())
            this._notify(update);
    }

    _notify({version, release}) {
        this._source = new MessageTray.Source({title: 'Source Glance', icon: this._gicon});
        this._source.connect('destroy', () => {
            this._source = null;
        });
        Main.messageTray.add(this._source);
        const notification = new MessageTray.Notification({
            source: this._source,
            title: _('Source Glance %s is available').format(version),
            body: releaseNotesSummary(release.body) || _('A new version is ready to install.'),
            gicon: this._gicon,
        });
        notification.addAction(_('Install'), () => this._onInstall());
        this._source.addNotification(notification);
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._cancellable?.cancel();
        this._cancellable = null;
        this._source?.destroy();
        this._source = null;
    }
}
