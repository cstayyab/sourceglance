// Minimal GitHub REST client on Soup 3 (ADR 0003).
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {
    DEVICE_GRANT_TYPE,
    buildSearchPath,
    classifyDeviceTokenResponse,
    classifyGraphqlErrors,
    classifyHttpError,
    formEncode,
    isValidRepo,
    parseDeviceCodeResponse,
    parseLabels,
    parseLogins,
    parseProjectItems,
    parseSearchResponse,
    parseViewerBoards,
    projectItemsRequest,
    viewerBoardsRequest,
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
        return this._request('GET', path, token, null, cancellable);
    }

    /** REST call with an optional JSON body. Resolves to the parsed JSON, or null for 204. */
    async _request(method, path, token, body, cancellable) {
        const message = Soup.Message.new(method, `${API_BASE}${path}`);
        const headers = message.get_request_headers();
        headers.append('Accept', 'application/vnd.github+json');
        headers.append('X-GitHub-Api-Version', '2022-11-28');
        if (token)
            headers.append('Authorization', `Bearer ${token}`);
        if (body !== null && body !== undefined) {
            message.set_request_body_from_bytes('application/json',
                new GLib.Bytes(new TextEncoder().encode(JSON.stringify(body))));
        }
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
        if (status < 200 || status >= 300) {
            const responseHeaders = {};
            message.get_response_headers().foreach((name, value) => {
                responseHeaders[name.toLowerCase()] = value;
            });
            throw new GitHubError(classifyHttpError(status, responseHeaders, Date.now()));
        }

        const text = new TextDecoder().decode(bytes.toArray());
        if (status === Soup.Status.NO_CONTENT || !text)
            return null;
        try {
            return JSON.parse(text);
        } catch {
            throw new GitHubError({kind: 'unknown', status, retryAt: null});
        }
    }

    /** Resolves to the login of the token's owner. */
    async getViewer(token, cancellable = null) {
        const user = await this._get('/user', token, cancellable);
        return user.login;
    }

    /**
     * Resolves to {total, items} for one search: 'issue' (open issues assigned to you),
     * 'pr-assigned' or 'pr-review' (open PRs assigned to you / awaiting your review).
     */
    async search(token, repos = [], search = 'issue', cancellable = null) {
        const json = await this._get(buildSearchPath(repos, search), token, cancellable);
        return parseSearchResponse(json, search);
    }

    /** Resolves to how many items a search finds, e.g. 'issue-closed' or 'pr-closed'. */
    async countSearch(token, repos = [], search = 'issue-closed', cancellable = null) {
        const json = await this._get(buildSearchPath(repos, search), token, cancellable);
        return Number.isInteger(json?.total_count) ? json.total_count : 0;
    }

    /**
     * Resolves to your project boards with their draft items (see parseViewerBoards()). Rejects
     * only if GitHub returned no data at all, e.g. the sign-in can't read projects.
     */
    async getViewerBoards(token, cancellable = null) {
        const request = viewerBoardsRequest();
        const json = await this._request(request.method, request.path, token, request.body, cancellable);
        if (!json?.data && json?.errors?.length)
            throw new GitHubError({kind: classifyGraphqlErrors(json.errors), status: 200, retryAt: null});
        return parseViewerBoards(json);
    }

    /**
     * Runs a request built by model.js (closeRequest(), moveStatusRequest() and so on).
     * GraphQL requests fail on any `errors`, since a write must apply fully.
     */
    async send(token, request, cancellable = null) {
        if (!request)
            throw new TypeError('sourceglance: empty request');
        const json = await this._request(request.method, request.path, token, request.body, cancellable);
        if (request.graphql && json?.errors?.length)
            throw new GitHubError({kind: classifyGraphqlErrors(json.errors), status: 200, retryAt: null});
        return json;
    }

    /**
     * Resolves to a Map of item node ID → project boards (see parseProjectItems()). Boards the
     * sign-in can't see are left out instead of failing the whole call.
     */
    async getProjectBoards(token, nodeIds, cancellable = null) {
        const request = projectItemsRequest(nodeIds);
        if (!request)
            return new Map();
        const json = await this._request(request.method, request.path, token, request.body, cancellable);
        if (!json?.data && json?.errors?.length)
            throw new GitHubError({kind: classifyGraphqlErrors(json.errors), status: 200, retryAt: null});
        return parseProjectItems(json);
    }

    /** Resolves to the repository's labels, [{name, color}] (first 100). */
    async listLabels(token, repo, cancellable = null) {
        if (!isValidRepo(repo))
            throw new TypeError('sourceglance: not a valid repository');
        return parseLabels(await this._get(`/repos/${repo}/labels?per_page=100`, token, cancellable));
    }

    /** Resolves to the logins that can be assigned in the repository (first 100). */
    async listAssignable(token, repo, cancellable = null) {
        if (!isValidRepo(repo))
            throw new TypeError('sourceglance: not a valid repository');
        return parseLogins(await this._get(`/repos/${repo}/assignees?per_page=100`, token, cancellable));
    }

    /** Starts device-flow sign-in. Resolves to {deviceCode, userCode, verificationUri, expiresIn, interval}. */
    async requestDeviceCode(clientId, scope = null, cancellable = null) {
        const fields = scope ? {client_id: clientId, scope} : {client_id: clientId};
        const json = await this._postForm(DEVICE_CODE_URL, fields, cancellable);
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
