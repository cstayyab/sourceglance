// Minimal gitlab.com client on Soup 3, like github.js: device-flow sign-in with token
// refresh, the assigned/review lists, closed counts and the write requests.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {DeviceFlowError, GitHubError as ApiError, isCancelled} from './github.js';
import {
    GITLAB_API,
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

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

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
    constructor(version = 'dev') {
        this._session = new Soup.Session({user_agent: `sourceglance/${version}`, timeout: 30});
    }

    destroy() {
        this._session?.abort();
        this._session = null;
    }

    /** Resolves to {json, headers}; GitLab errors become ApiError like GitHub's. */
    async _send(message, cancellable, {allowError = false} = {}) {
        let bytes;
        try {
            bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
        } catch (e) {
            if (isCancelled(e))
                throw e;
            throw new ApiError(classifyHttpError(0));
        }
        const status = message.get_status();
        const headers = {};
        message.get_response_headers().foreach((name, value) => {
            headers[name.toLowerCase()] = value;
        });
        const text = new TextDecoder().decode(bytes.toArray());
        let json = null;
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
        const message = Soup.Message.new(method, `${GITLAB_API}${path}`);
        message.get_request_headers().append('Authorization', `Bearer ${token}`);
        if (body !== null && body !== undefined) {
            message.set_request_body_from_bytes('application/json',
                new GLib.Bytes(new TextEncoder().encode(JSON.stringify(body))));
        }
        return this._send(message, cancellable);
    }

    async _oauth(path, fields, cancellable) {
        const message = Soup.Message.new('POST', `${GITLAB_HOST}${path}`);
        message.get_request_headers().append('Accept', 'application/json');
        message.set_request_body_from_bytes('application/x-www-form-urlencoded',
            new GLib.Bytes(new TextEncoder().encode(formEncode(fields))));
        // The token endpoint answers 400 while waiting (authorization_pending).
        return (await this._send(message, cancellable, {allowError: true})).json;
    }

    // Sign-in

    async requestDeviceCode(clientId, cancellable = null) {
        const json = await this._oauth('/oauth/authorize_device', {client_id: clientId, scope: GITLAB_SCOPE}, cancellable);
        const code = parseGitLabDeviceCode(json);
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
     */
    async accessToken(clientId, cancellable = null) {
        const auth = parseStoredAuth(await lookupSecret(GITLAB_ACCOUNT, cancellable));
        if (!auth)
            return null;
        if (!tokenNeedsRefresh(auth))
            return auth.access;
        try {
            const fresh = await this.refresh(clientId, auth.refresh, cancellable);
            await storeSecret(GITLAB_ACCOUNT, JSON.stringify(fresh), cancellable);
            return fresh.access;
        } catch (e) {
            if (isCancelled(e))
                throw e;
            const again = parseStoredAuth(await lookupSecret(GITLAB_ACCOUNT, cancellable));
            return again && again.access !== auth.access ? again.access : auth.access;
        }
    }

    // Reading

    /** Resolves to {id, username} of the signed-in user. */
    async getViewer(token, cancellable = null) {
        const {json} = await this._api('GET', '/user', token, null, cancellable);
        return {id: json?.id, username: json?.username};
    }

    /** One list ('issue', 'mr-assigned', 'mr-review'): {total, items}. */
    async list(token, search, username = null, cancellable = null) {
        const {json, headers} = await this._api('GET', listPath(search, username), token, null, cancellable);
        const items = parseGitLabItems(json, search);
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
