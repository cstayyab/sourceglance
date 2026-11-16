// Minimal GitHub REST client on Soup 3 (ADR 0003).
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {
    DEVICE_GRANT_TYPE,
    DEVICE_SCOPE,
    buildSearchPath,
    classifyDeviceTokenResponse,
    classifyHttpError,
    formEncode,
    parseDeviceCodeResponse,
    parseSearchResponse,
} from './model.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

const API_BASE = 'https://api.github.com';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const DEVICE_TOKEN_URL = 'https://github.com/login/oauth/access_token';

/** Device-flow sign-in ended without a token: kind is expired, denied or error. */
export class DeviceFlowError extends Error {
    constructor(kind, detail = kind) {
        super(`GitHub sign-in failed: ${detail}`);
        this.name = 'DeviceFlowError';
        this.kind = kind;
        this.detail = detail;
    }
}

function cancelledError() {
    return new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Operation was cancelled');
}

/** Resolves after `seconds`, or rejects as cancelled. */
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

export class GitHubError extends Error {
    constructor({kind, status, retryAt}) {
        super(`GitHub request failed: ${kind} (HTTP ${status})`);
        this.name = 'GitHubError';
        this.kind = kind;
        this.status = status;
        this.retryAt = retryAt;
    }
}

export function isCancelled(error) {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

export class GitHubClient {
    constructor(version = 'dev') {
        this._session = new Soup.Session({user_agent: `sourceglance/${version}`, timeout: 30});
    }

    destroy() {
        this._session?.abort();
        this._session = null;
    }

    async _get(path, token, cancellable) {
        const message = Soup.Message.new('GET', `${API_BASE}${path}`);
        const headers = message.get_request_headers();
        headers.append('Accept', 'application/vnd.github+json');
        headers.append('X-GitHub-Api-Version', '2022-11-28');
        if (token)
            headers.append('Authorization', `Bearer ${token}`);
        return this._send(message, cancellable);
    }

    /** Form POST to github.com's OAuth endpoints, which answer JSON when asked to. */
    async _postForm(url, fields, cancellable) {
        const message = Soup.Message.new('POST', url);
        message.get_request_headers().append('Accept', 'application/json');
        message.set_request_body_from_bytes('application/x-www-form-urlencoded',
            new GLib.Bytes(new TextEncoder().encode(formEncode(fields))));
        return this._send(message, cancellable);
    }

    async _send(message, cancellable) {
        let bytes;
        try {
            bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
        } catch (e) {
            if (isCancelled(e))
                throw e;
            throw new GitHubError(classifyHttpError(0));
        }

        const status = message.get_status();
        if (status !== Soup.Status.OK) {
            const responseHeaders = {};
            message.get_response_headers().foreach((name, value) => {
                responseHeaders[name.toLowerCase()] = value;
            });
            throw new GitHubError(classifyHttpError(status, responseHeaders, Date.now()));
        }

        try {
            return JSON.parse(new TextDecoder().decode(bytes.toArray()));
        } catch {
            throw new GitHubError({kind: 'unknown', status, retryAt: null});
        }
    }

    /** Resolves to the login of the token's owner. */
    async getViewer(token, cancellable = null) {
        const user = await this._get('/user', token, cancellable);
        return user.login;
    }

    /** Resolves to {total, issues} for open issues assigned to the token's owner. */
    async searchAssignedIssues(token, repos = [], cancellable = null) {
        const json = await this._get(buildSearchPath(repos), token, cancellable);
        return parseSearchResponse(json);
    }

    /** Starts device-flow sign-in. Resolves to {deviceCode, userCode, verificationUri, expiresIn, interval}. */
    async requestDeviceCode(clientId, cancellable = null) {
        const json = await this._postForm(DEVICE_CODE_URL, {client_id: clientId, scope: DEVICE_SCOPE}, cancellable);
        const code = parseDeviceCodeResponse(json);
        if (!code)
            throw new DeviceFlowError('error', json?.error ?? 'bad device code response');
        return code;
    }

    /**
     * Polls until the user approves the code in the browser. Resolves to the access token;
     * rejects with DeviceFlowError, GitHubError, or a cancelled GLib.Error.
     */
    async waitForDeviceToken(clientId, {deviceCode, expiresIn, interval}, cancellable = null) {
        const deadline = Date.now() + expiresIn * 1000;
        while (Date.now() < deadline) {
            await sleep(interval, cancellable);
            const json = await this._postForm(DEVICE_TOKEN_URL, {
                client_id: clientId,
                device_code: deviceCode,
                grant_type: DEVICE_GRANT_TYPE,
            }, cancellable);
            const result = classifyDeviceTokenResponse(json, interval);
            switch (result.state) {
            case 'done':
                return result.token;
            case 'pending':
            case 'slow-down':
                interval = result.interval;
                break;
            default:
                throw new DeviceFlowError(result.state, result.error);
            }
        }
        throw new DeviceFlowError('expired');
    }
}
