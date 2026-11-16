// "Update available" in the window's title bar, next to Refresh. Asks GitHub's public
// releases API whether a newer sourceglance is out. Clicking it downloads the new Setup,
// checks it against the release's SHA256SUMS and opens it (updater.js); Setup's wizard
// then upgrades the installation. If that fails, it opens the home page's Update section.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {HOME_URL} from '../lib/config.js';
import {isCancelled} from '../lib/github.js';
import {UpdateError, downloadVerifiedSetup, launchSetup} from '../lib/updater.js';
import {availableUpdate} from '../lib/updates.js';

// Refresh checks again, but not more often than this (GitHub allows 60 anonymous calls an hour).
const MIN_INTERVAL_MS = 10 * 60 * 1000;

export class UpdateButton {
    /** `version` is the installed version-name, e.g. "0.2.0"; `toast(text)` shows a message. */
    constructor({window, client, settings, version, toast}) {
        this._window = window;
        this._toast = toast;
        this._client = client;
        this._settings = settings;
        this._version = version;
        this._lastCheck = 0;
        this._cancellable = null;
        this._content = new Adw.ButtonContent({icon_name: 'software-update-available-symbolic', label: _('Update available')});
        this.widget = new Gtk.Button({
            visible: false,
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
            child: this._content,
        });
        this.widget.connect('clicked', () => this._install());
        this._settingsId = settings.connect('changed::check-updates', () => this.check({force: true}));
    }

    /** Checks for a newer release, at most every few minutes unless `force`. */
    async check({force = false} = {}) {
        if (!this._settings.get_boolean('check-updates')) {
            this.widget.visible = false;
            return;
        }
        if (!force && Date.now() - this._lastCheck < MIN_INTERVAL_MS)
            return;
        this._lastCheck = Date.now();
        this._cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        try {
            const version = availableUpdate(await this._client.listReleases(cancellable), this._version);
            this.widget.visible = Boolean(version);
            if (version) {
                this.widget.tooltip_text = _('sourceglance %s is available. Click to download, check and open its Setup, which updates sourceglance.')
                    .format(version);
            }
        } catch (e) {
            // Offline or rate-limited: keep quiet and try again next time.
            if (!isCancelled(e))
                console.debug(`sourceglance: update check failed: ${e.message}`);
        } finally {
            if (this._cancellable === cancellable)
                this._cancellable = null;
        }
    }

    /** Downloads, verifies and opens the new Setup. */
    async _install() {
        this.widget.sensitive = false;
        this._content.label = _('Downloading…');
        this._cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        try {
            const {version, path} = await downloadVerifiedSetup(this._client, this._version, cancellable);
            launchSetup(path);
            this._toast(_('sourceglance Setup %s is open. Follow it to finish updating.').format(version));
        } catch (e) {
            if (isCancelled(e))
                return;
            if (e instanceof UpdateError && e.kind === 'up-to-date') {
                this.widget.visible = false;
                this._toast(_('sourceglance is up to date'));
                return;
            }
            console.warn(`sourceglance: update failed: ${e.message}`);
            this._toast(e instanceof UpdateError && e.kind === 'checksum'
                ? _('The download didn’t match its checksum, so it wasn’t opened. Opening the home page instead.')
                : _('Couldn’t download the update. Opening the home page instead.'));
            new Gtk.UriLauncher({uri: `${HOME_URL}#update`}).launch(this._window, null, null);
        } finally {
            if (this._cancellable === cancellable)
                this._cancellable = null;
            this._content.label = _('Update available');
            this.widget.sensitive = true;
        }
    }

    destroy() {
        this._cancellable?.cancel();
        this._settings.disconnect(this._settingsId);
    }
}
