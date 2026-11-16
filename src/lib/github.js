// Minimal GitHub REST client on Soup 3 (ADR 0003).
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {buildSearchPath, classifyHttpError, parseSearchResponse} from './model.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

const API_BASE = 'https://api.github.com';

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
}
