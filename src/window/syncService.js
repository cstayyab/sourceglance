// Signing in to a sync server and keeping this computer in step with it: accounts (personal access
// tokens, kept in the keyring here and encrypted on the server), the settings that follow you, and the AI
// instructions. What to pull and push is decided in lib/sync.js; this file sends the requests and writes
// the results. The sign-in token lives in the keyring, never in settings.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Soup from 'gi://Soup?version=3.0';

import {gettext as _} from './i18n.js';

import {notifyAccountsChanged, readAccounts} from '../lib/accountStore.js';
import {accountTitle, sameAccount, serializeAccounts, withAccount} from '../lib/accounts.js';
import {
    SYNCED_SETTINGS,
    accountKey,
    agreedAfterSync,
    canonicalJson,
    classifyTokenResponse,
    decideSettings,
    deleteAccountRequest,
    deviceCodeRequest,
    deviceLabel,
    deviceTokenRequest,
    hintsFor,
    isSyncable,
    parseDeviceCode,
    parsePrompts,
    parseServerUrl,
    parseState,
    planAccountSync,
    promptsRequest,
    putAccountRequest,
    putHintsRequest,
    putSettingsRequest,
    secretFor,
    signOutRequest,
    stateRequest,
    syncedAccountId,
    tokenFromSecret,
} from '../lib/sync.js';
import {clearSecret, lookupSecret, storeSecret} from '../lib/tokenStore.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

const DEVICE_SECRET = 'sync:device';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const AUTO_SYNC_SECONDS = 600;
const CHANGE_DELAY_SECONDS = 4;

const fingerprint = text => GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, text, -1);
const sleep = (seconds, cancellable) => new Promise((resolve, reject) => {
    const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
    cancellable?.connect(() => {
        GLib.source_remove(id);
        reject(new Error('cancelled'));
    });
});

export class SyncService {
    /** `secrets`, `send` and `openLink` can be replaced (tests): the keyring, how a request reaches the server, and how a page opens. */
    constructor({window, settings, version, toast, secrets = null, send = null, openLink = null}) {
        this._openLink = openLink ?? (link => new Gtk.UriLauncher({uri: link}).launch(window, null, null));
        this._window = window;
        this._settings = settings;
        this._toast = toast;
        this._secrets = secrets ?? {lookup: lookupSecret, store: storeSecret, clear: clearSecret};
        this._session = send ? null : new Soup.Session({user_agent: `sourceglance/${version}`, timeout: 30});
        this._send = send ?? (request => this._soup(request));
        this._hasKeys = settings.settings_schema.has_key('sync-server');
        this._listeners = [];
        this._signedIn = false;
        this._email = '';
        this._plan = null;
        this._prompts = null;
        this._busy = false;
        this._error = '';
        this._lastSync = null;
        this._summary = null;
        this._signInCancel = null;
        this._applying = false;
        this._timers = [];
        this._handlerIds = [];
    }

    // What the pages show.

    get available() {
        return this._hasKeys;
    }

    get server() {
        return this._hasKeys ? this._settings.get_string('sync-server') : '';
    }

    /** Whether the AI buttons are turned on for the server (chosen when connecting; on by default). */
    get featureAi() {
        return this._hasKeys && this._settings.get_boolean('sync-feature-ai');
    }

    /** Whether account tokens are backed up, encrypted, on the server (off by default). */
    get featureTokens() {
        return this._hasKeys && this._settings.get_boolean('sync-feature-tokens');
    }

    get signedIn() {
        return this._signedIn;
    }

    get email() {
        return this._email;
    }

    get plan() {
        return this._plan;
    }

    get busy() {
        return this._busy;
    }

    get error() {
        return this._error;
    }

    get lastSync() {
        return this._lastSync;
    }

    /** What the last sync did: {pulled, pushed, removed, kept, problems}. */
    get summary() {
        return this._summary;
    }

    /** The AI instructions from the server, or null while signed out or unreachable. */
    get prompts() {
        return this._signedIn && this.featureAi ? this._prompts : null;
    }

    /** Whether the AI buttons may work: signed in and the instructions are here. */
    get aiReady() {
        return this.prompts !== null;
    }

    onChanged(callback) {
        this._listeners.push(callback);
    }

    _changed() {
        for (const callback of this._listeners)
            callback();
    }

    // Starting and stopping.

    /** Picks up an earlier sign-in, syncs, and keeps syncing. */
    async start() {
        if (!this._hasKeys)
            return;
        const watched = ['accounts', 'sync-feature-ai', 'sync-feature-tokens', ...Object.keys(SYNCED_SETTINGS)].filter(key => this._settings.settings_schema.has_key(key));
        for (const key of watched)
            this._handlerIds.push(this._settings.connect(`changed::${key}`, () => this._scheduleSync()));
        // A feature switch takes effect at once (the AI buttons lock or unlock); the sync that follows does the rest.
        for (const key of ['sync-feature-ai', 'sync-feature-tokens'])
            this._handlerIds.push(this._settings.connect(`changed::${key}`, () => this._changed()));
        this._timers.push(GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, AUTO_SYNC_SECONDS, () => {
            void this.sync({silent: true});
            return GLib.SOURCE_CONTINUE;
        }));
        // A sign-in with no server to go with it (the setting was reset) is not a sign-in.
        if (this.server && await this._token()) {
            this._signedIn = true;
            this._changed();
            await this.sync({silent: true});
        }
    }

    destroy() {
        this._signInCancel?.cancel();
        for (const id of this._handlerIds)
            this._settings.disconnect(id);
        this._handlerIds = [];
        for (const id of this._timers)
            GLib.source_remove(id);
        this._timers = [];
        this._session?.abort();
    }

    /** A change here (an account, a synced setting) is sent a few seconds later, in one go. */
    _scheduleSync() {
        if (this._applying || !this._signedIn)
            return;
        if (this._changeTimer)
            GLib.source_remove(this._changeTimer);
        this._changeTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CHANGE_DELAY_SECONDS, () => {
            this._changeTimer = 0;
            void this.sync({silent: true});
            return GLib.SOURCE_REMOVE;
        });
    }

    // Requests.

    async _soup({method, url, headers, body}) {
        const message = Soup.Message.new(method, url);
        if (!message)
            throw new Error(_('That server address can’t be used'));
        for (const [name, value] of Object.entries(headers))
            message.request_headers.append(name, value);
        if (body !== null)
            message.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(body)));
        // Never follow a redirect: it could lead the sign-in to another host.
        message.add_flags(Soup.MessageFlags.NO_REDIRECT);
        const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        if (bytes.get_size() > MAX_BODY_BYTES)
            throw new Error(_('The server’s answer was too large'));
        let json = null;
        try {
            json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
        } catch {
            // Not JSON: the status says enough.
        }
        return {status: message.status_code, json};
    }

    async _token() {
        try {
            return await this._secrets.lookup(DEVICE_SECRET);
        } catch (e) {
            console.warn(`sourceglance: keyring unavailable: ${e.message}`);
            return null;
        }
    }

    // Signing in (the device flow).

    /**
     * Starts a sign-in on `serverText`. `onCode({userCode, link})` is called once the code is known; the browser
     * opens at the server's own page, where you check that the code matches and approve. Resolves to
     * {ok: true} or {error}.
     */
    async signIn(serverText, onCode) {
        const parsed = parseServerUrl(serverText);
        if (parsed.error)
            return {error: this._serverProblem(parsed.error)};
        const base = parsed.url;
        this._signInCancel?.cancel();
        const cancel = new Gio.Cancellable();
        this._signInCancel = cancel;
        try {
            const started = await this._send(deviceCodeRequest(base, deviceLabel(GLib.get_host_name())));
            const code = started.status === 200 ? parseDeviceCode(started.json, base) : null;
            if (!code)
                return {error: _('That server didn’t start a sign-in. Check the address.')};
            onCode({userCode: code.userCode, link: code.link});
            this._openLink(code.link);
            let wait = code.interval;
            const deadline = GLib.get_monotonic_time() / 1e6 + code.expiresIn;
            let failures = 0;
            while (GLib.get_monotonic_time() / 1e6 < deadline) {
                await sleep(wait, cancel);
                const answer = classifyTokenResponse(...await this._poll(base, code.deviceCode));
                switch (answer.kind) {
                case 'ok':
                    await this._secrets.store(DEVICE_SECRET, answer.token, null, 'Source Glance sync sign-in');
                    this._settings.set_string('sync-server', base);
                    this._signedIn = true;
                    this._email = answer.email;
                    this._error = '';
                    this._changed();
                    await this.sync({silent: false});
                    return {ok: true};
                case 'slow-down':
                    wait += 5;
                    break;
                case 'denied':
                    return {error: _('The sign-in was denied')};
                case 'expired':
                    return {error: _('The code expired. Start again.')};
                case 'error':
                    if (++failures >= 4)
                        return {error: _('The server didn’t answer as expected')};
                    break;
                }
            }
            return {error: _('The code expired. Start again.')};
        } catch (e) {
            if (cancel.is_cancelled())
                return {error: _('Cancelled')};
            return {error: _('Couldn’t reach the server: %s').format(e.message)};
        } finally {
            if (this._signInCancel === cancel)
                this._signInCancel = null;
        }
    }

    async _poll(base, deviceCode) {
        const {status, json} = await this._send(deviceTokenRequest(base, deviceCode));
        return [status, json];
    }

    cancelSignIn() {
        this._signInCancel?.cancel();
    }

    _serverProblem(error) {
        switch (error) {
        case 'insecure':
            return _('Use an https:// address. Plain http:// is only for this computer (localhost).');
        case 'path':
            return _('Give the server’s address only, without a path.');
        case 'credentials':
            return _('The address can’t contain a user name or password.');
        case 'empty':
            return _('Enter the server’s address.');
        default:
            return _('That doesn’t look like a server address.');
        }
    }

    /** Signs out of the server. Accounts already on this computer stay. */
    async signOut() {
        const token = await this._token();
        const base = this.server;
        if (token && base) {
            // Best effort: if the server can't be reached the token is still forgotten here, and can be revoked on the web.
            await this._send(signOutRequest(base, token)).catch(() => undefined);
        }
        await this._forget();
        this._toast(_('Signed out of the sync server'));
    }

    async _forget() {
        try {
            await this._secrets.clear(DEVICE_SECRET);
        } catch (e) {
            console.warn(`sourceglance: couldn't clear the sync sign-in: ${e.message}`);
        }
        this._applying = true;
        this._settings.set_int('sync-revision', 0);
        this._settings.set_string('sync-settings-hash', '');
        this._settings.set_value('sync-fingerprints', new GLib.Variant('a{ss}', {}));
        this._applying = false;
        this._signedIn = false;
        this._email = '';
        this._plan = null;
        this._prompts = null;
        this._summary = null;
        this._error = '';
        this._changed();
    }

    // Syncing.

    _readSynced() {
        const data = {};
        for (const [key, kind] of Object.entries(SYNCED_SETTINGS)) {
            if (!this._settings.settings_schema.has_key(key))
                continue;
            if (kind === 'string')
                data[key] = this._settings.get_string(key);
            else if (kind === 'list')
                data[key] = this._settings.get_strv(key);
            else
                data[key] = this._settings.get_value(key).deepUnpack();
        }
        return data;
    }

    _applySynced(data) {
        this._applying = true;
        try {
            for (const [key, kind] of Object.entries(SYNCED_SETTINGS)) {
                if (!(key in data) || !this._settings.settings_schema.has_key(key))
                    continue;
                if (kind === 'string')
                    this._settings.set_string(key, data[key]);
                else if (kind === 'list')
                    this._settings.set_strv(key, data[key]);
                else
                    this._settings.set_value(key, new GLib.Variant('a{ss}', data[key]));
            }
        } finally {
            this._applying = false;
        }
    }

    /** The accounts here that can travel, each with its token. */
    async _localAccounts() {
        const result = [];
        for (const account of readAccounts(this._settings).filter(isSyncable)) {
            // A token that can't be read (keyring locked or cleared) is null, and the account stays: see planAccountSync().
            const token = tokenFromSecret(account.platform, await this._secrets.lookup(account.id).catch(() => null));
            result.push({...account, token});
        }
        return result;
    }

    /** One round: accounts, settings, then the AI instructions. */
    async sync({silent = false} = {}) {
        const base = this.server;
        if (this._busy || !base)
            return;
        const token = await this._token();
        if (!token) {
            if (this._signedIn)
                await this._forget();
            return;
        }
        this._busy = true;
        this._changed();
        try {
            const answer = await this._send(stateRequest(base, token, {tokens: this.featureTokens}));
            if (answer.status === 401) {
                await this._forget();
                this._toast(_('The server signed this computer out. Sign in again in Settings → Sync server.'));
                return;
            }
            const state = answer.status === 200 ? parseState(answer.json) : null;
            if (!state)
                throw new Error(_('The server’s answer was not understood'));
            this._signedIn = true;
            this._email = state.email;
            this._plan = state.plan;
            // Settings are always saved. Tokens and the AI instructions only when you turned those on.
            const summary = this.featureTokens
                ? await this._syncAccounts(base, token, state)
                : {pulled: 0, pushed: 0, removed: 0, kept: 0, problems: []};
            if (this.featureTokens)
                await this._sendHints(base, token);
            await this._syncSettings(base, token, state);
            if (this.featureAi)
                await this._loadPrompts(base, token);
            else
                this._prompts = null;
            this._summary = summary;
            this._lastSync = new Date();
            this._error = '';
            if (!silent)
                this._toast(_('Synced with %s').format(base.replace(/^https?:\/\//, '')));
        } catch (e) {
            this._error = e.message;
            if (!silent)
                this._toast(_('Sync failed: %s').format(e.message));
        } finally {
            this._busy = false;
            this._changed();
        }
    }

    /** Tells the server which browser sign-ins are on this computer (never their tokens), so it can offer to sign in to them too. */
    async _sendHints(base, token) {
        try {
            await this._send(putHintsRequest(base, token, hintsFor(readAccounts(this._settings))));
        } catch (e) {
            // Only a convenience: an older server doesn't know the call, and the rest of the sync goes on.
            console.warn(`Sync: could not send sign-in hints: ${e.message}`);
        }
    }

    /** Lists an account pulled from the server and keeps its sign-in in the keyring (as AccountStore's saveAccount() does). */
    async _saveAccount(account, secret) {
        const accounts = withAccount(readAccounts(this._settings), account);
        const saved = accounts.find(other => sameAccount(other, account));
        await this._secrets.store(saved.id, secret, null, `Source Glance: ${accountTitle(saved)}`);
        this._settings.set_strv('accounts', serializeAccounts(accounts));
        notifyAccountsChanged(this._settings);
    }

    async _syncAccounts(base, token, state) {
        const local = await this._localAccounts();
        const agreed = this._settings.get_value('sync-fingerprints').deepUnpack();
        const plan = planAccountSync(local, state.accounts, agreed, fingerprint);
        const summary = {pulled: 0, pushed: 0, removed: 0, kept: plan.kept.length, problems: []};
        const final = new Map(state.accounts.map(account => [accountKey(account), account]));

        this._applying = true;
        try {
            for (const account of plan.pull) {
                try {
                    await this._saveAccount({id: syncedAccountId(account), platform: account.platform, base: account.base,
                        login: account.login, method: 'pat', clientId: null}, secretFor(account.platform, account.token));
                    summary.pulled++;
                } catch (e) {
                    // Most likely the keyring is locked: this account isn't saved, and nothing is removed on its account.
                    summary.problems.push(`${account.login}: ${e.message}`);
                }
            }
        } finally {
            this._applying = false;
        }
        for (const account of plan.push) {
            const reply = await this._send(putAccountRequest(base, token, account));
            if (reply.status === 200 || reply.status === 201) {
                final.set(accountKey(account), account);
                summary.pushed++;
            } else {
                summary.problems.push(`${account.login}: ${reply.json?.message ?? reply.status}`);
            }
        }
        for (const account of plan.removeRemote) {
            const reply = await this._send(deleteAccountRequest(base, token, account.id));
            if (reply.status === 200 || reply.status === 404) {
                final.delete(accountKey(account));
                summary.removed++;
            }
        }
        const kept = plan.kept;
        this._settings.set_value('sync-fingerprints',
            new GLib.Variant('a{ss}', agreedAfterSync([...final.values(), ...kept], fingerprint)));
        return summary;
    }

    async _syncSettings(base, token, state) {
        const local = this._readSynced();
        const decision = decideSettings({
            local, remote: state.settings, lastRevision: this._settings.get_int('sync-revision'),
            lastHash: this._settings.get_string('sync-settings-hash'), hash: fingerprint,
        });
        let revision = state.settings.revision;
        let data = local;
        if (decision.action === 'apply') {
            this._applySynced(decision.data);
            data = this._readSynced();
            revision = decision.revision;
        } else if (decision.action === 'push') {
            const reply = await this._send(putSettingsRequest(base, token, decision.revision, decision.data));
            if (reply.status === 200 && Number.isInteger(reply.json?.revision)) {
                revision = reply.json.revision;
            } else if (reply.status === 409 && reply.json?.data) {
                // Someone else changed them first: theirs win.
                this._applySynced(reply.json.data);
                data = this._readSynced();
                revision = reply.json.revision;
            } else {
                throw new Error(_('The settings could not be saved on the server'));
            }
        }
        this._settings.set_int('sync-revision', revision);
        this._settings.set_string('sync-settings-hash', fingerprint(canonicalJson(data)));
    }

    async _loadPrompts(base, token) {
        const reply = await this._send(promptsRequest(base, token));
        this._prompts = reply.status === 200 ? parsePrompts(reply.json) : null;
    }
}
