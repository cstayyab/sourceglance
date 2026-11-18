// Minimal GitLab client on Soup 3, like github.js, for gitlab.com or a self-managed instance
// (ADR 0007): device-flow sign-in with token refresh, the assigned/review lists, closed counts
// and the write requests.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {gitlabUrls, parseGitLabDiscovery} from './accounts.js';
import {GITLAB_CLIENT_ID} from './config.js';
import {DeviceFlowError, GitHubError as ApiError, isCancelled, transportError} from './github.js';
import {
    GITLAB_HOST,
    GITLAB_SCOPE,
    closedCountPaths,
    listPath,
    parseGitLabDeviceCode,
    parseGitLabItems,
    parseGitLabLabels,
    parseGitLabMembers,
    parseGitLabToken,
    parseStoredAuth,
    tokenNeedsRefresh,
} from './gitlabModel.js';
import {DEVICE_GRANT_TYPE, classifyDeviceTokenResponse, classifyHttpError, formEncode} from './model.js';
import {GITLAB_ACCOUNT, lookupSecret, storeSecret} from './tokenStore.js';
import {Transport} from './transport.js';

function cancelledError() {
    return new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Operation was cancelled');
}

function sleep(seconds, cancellable) {
    return new Promise((resolve, reject) => {
        if (cancellable?.is_cancelled()) {
            reject(cancelledError());
            return;
        }
        let handlerId = 0;
        const sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            if (handlerId)
                cancellable.disconnect(handlerId);
            resolve();
            return GLib.SOURCE_REMOVE;
        });
        if (cancellable) {
            handlerId = cancellable.connect(() => {
                GLib.source_remove(sourceId);
                reject(cancelledError());
            });
        }
    });
}

export class GitLabClient {
    /**
     * `base` is the instance; `accountId` the keyring entry holding the sign-in; `clientId` the
     * OAuth application that signed in (null: Source Glance's own, on gitlab.com), for renewing.
     */
    constructor(version = 'dev', {base = GITLAB_HOST, accountId = GITLAB_ACCOUNT, clientId = null} = {}) {
        this.base = base;
        this._urls = gitlabUrls(base);
        this._accountId = accountId;
        this._clientId = clientId ?? GITLAB_CLIENT_ID;
        this._transport = new Transport(version, base === GITLAB_HOST ? null : base);
    }

    destroy() {
        this._transport?.destroy();
        this._transport = null;
    }

    /** Resolves to {json, headers}; GitLab errors become ApiError like GitHub's. */
    async _send(message, cancellable, {allowError = false} = {}) {
        let bytes;
        try {
            bytes = await this._transport.send(message, cancellable);
        } catch (e) {
            throw transportError(e);
        }
        const status = message.get_status();
        const headers = {};
        message.get_response_headers().foreach((name, value) => {
            headers[name.toLowerCase()] = value;
        });
        const text = new TextDecoder().decode(bytes.toArray());
        let json;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }
        if ((status < 200 || status >= 300) && !allowError)
            throw new ApiError(classifyHttpError(status, headers, Date.now()));
        return {json, headers, status};
    }

    async _api(method, path, token, body, cancellable) {
        const message = Soup.Message.new(method, `${this._urls.api}${path}`);
        message.get_request_headers().append('Authorization', `Bearer ${token}`);
        if (body !== null && body !== undefined) {
            message.set_request_body_from_bytes('application/json',
                new GLib.Bytes(new TextEncoder().encode(JSON.stringify(body))));
        }
        return this._send(message, cancellable);
    }

    async _oauth(path, fields, cancellable) {
        const message = Soup.Message.new('POST', `${this.base}${path}`);
        message.get_request_headers().append('Accept', 'application/json');
        message.set_request_body_from_bytes('application/x-www-form-urlencoded',
            new GLib.Bytes(new TextEncoder().encode(formEncode(fields))));
        // The token endpoint answers 400 while waiting (authorization_pending).
        return (await this._send(message, cancellable, {allowError: true})).json;
    }

    // Sign-in

    async requestDeviceCode(clientId, cancellable = null) {
        const json = await this._oauth('/oauth/authorize_device', {client_id: clientId, scope: GITLAB_SCOPE}, cancellable);
        const code = parseGitLabDeviceCode(json, this.base);
        if (!code)
            throw new DeviceFlowError('error', json?.error ?? 'bad device code response');
        return code;
    }

    /** Polls until you approve in the browser. Resolves to {access, refresh, expiresAt}. */
    async waitForDeviceToken(clientId, {deviceCode, expiresIn, interval}, cancellable = null) {
        const deadline = Date.now() + expiresIn * 1000;
        while (Date.now() < deadline) {
            await sleep(interval, cancellable);
            const json = await this._oauth('/oauth/token', {
                client_id: clientId, device_code: deviceCode, grant_type: DEVICE_GRANT_TYPE,
            }, cancellable);
            const auth = parseGitLabToken(json);
            if (auth)
                return auth;
            const result = classifyDeviceTokenResponse(json, interval);
            if (result.state === 'pending' || result.state === 'slow-down')
                interval = result.interval;
            else
                throw new DeviceFlowError(result.state, result.error);
        }
        throw new DeviceFlowError('expired');
    }

    async refresh(clientId, refreshToken, cancellable = null) {
        const json = await this._oauth('/oauth/token', {
            client_id: clientId, refresh_token: refreshToken, grant_type: 'refresh_token',
        }, cancellable);
        const auth = parseGitLabToken(json);
        if (!auth)
            throw new ApiError({kind: 'auth', status: 400, retryAt: null});
        return auth;
    }

    /**
     * The stored access token, renewed first when it's about to expire. Null when signed
     * out. If renewing fails, another process may have renewed already: use its token.
     * Personal access tokens are stored without a refresh token and never renewed.
     */
    async accessToken(cancellable = null) {
        const auth = parseStoredAuth(await lookupSecret(this._accountId, cancellable));
        if (!auth)
            return null;
        if (!tokenNeedsRefresh(auth))
            return auth.access;
        try {
            const fresh = await this.refresh(this._clientId, auth.refresh, cancellable);
            await storeSecret(this._accountId, JSON.stringify(fresh), cancellable);
            return fresh.access;
        } catch (e) {
            if (isCancelled(e))
                throw e;
            const again = parseStoredAuth(await lookupSecret(this._accountId, cancellable));
            return again && again.access !== auth.access ? again.access : auth.access;
        }
    }

    // Reading

    /**
     * For the self-hosted wizard: resolves to {device} (whether browser sign-in is offered)
     * if the instance is GitLab, else null. Its discovery document needs no sign-in.
     */
    async probe(cancellable = null) {
        const message = Soup.Message.new('GET', this._urls.discovery);
        const {json, status} = await this._send(message, cancellable, {allowError: true});
        return status >= 200 && status < 300 ? parseGitLabDiscovery(json, this.base) : null;
    }

    /** Resolves to {id, username} of the signed-in user. */
    async getViewer(token, cancellable = null) {
        const {json} = await this._api('GET', '/user', token, null, cancellable);
        return {id: json?.id, username: json?.username};
    }

    /** One list ('issue', 'mr-assigned', 'mr-review'): {total, items}. */
    async list(token, search, username = null, cancellable = null) {
        const {json, headers} = await this._api('GET', listPath(search, username), token, null, cancellable);
        const items = parseGitLabItems(json, search, this.base);
        const total = Number.parseInt(headers['x-total'], 10);
        return {total: Number.isNaN(total) ? items.length : total, items};
    }

    /** Closed issues and closed-or-merged MRs still assigned to you: {issues, prs}. */
    async closedCounts(token, cancellable = null) {
        const count = async paths => {
            let sum = 0;
            for (const path of paths) {
                const {headers} = await this._api('GET', path, token, null, cancellable);
                const total = Number.parseInt(headers['x-total'], 10);
                if (Number.isNaN(total))
                    return null;
                sum += total;
            }
            return sum;
        };
        const paths = closedCountPaths();
        return {issues: await count(paths.issues), prs: await count(paths.prs)};
    }

    async listMembers(token, projectId, cancellable = null) {
        const {json} = await this._api('GET', `/projects/${projectId}/members/all?per_page=100`, token, null, cancellable);
        return parseGitLabMembers(json);
    }

    async listLabels(token, projectId, cancellable = null) {
        const {json} = await this._api('GET', `/projects/${projectId}/labels?per_page=100`, token, null, cancellable);
        return parseGitLabLabels(json);
    }

    /** Runs a request built by gitlabModel.js. */
    async send(token, request, cancellable = null) {
        if (!request)
            throw new TypeError('sourceglance: empty request');
        return (await this._api(request.method, request.path, token, request.body, cancellable)).json;
    }
}
