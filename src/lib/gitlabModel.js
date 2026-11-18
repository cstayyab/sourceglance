// GitLab (gitlab.com or self-managed) parsing and request building. Pure: no gi:// or
// resource:// imports, unit-tested with Node like model.js (ADR 0004). Items come out in the
// same shape as GitHub's (see parseSearchResponse in model.js) with platform: 'gitlab'; merge
// requests use kind 'pr'. `base` is the instance, https://gitlab.com unless self-managed.
import {isSafeAccountUrl} from './accounts.js';

export const GITLAB_HOST = 'https://gitlab.com';
export const GITLAB_API = `${GITLAB_HOST}/api/v4`;
export const GITLAB_DEVICE_URL = `${GITLAB_HOST}/oauth/device`;
export const GITLAB_SCOPE = 'api';
export const GITLAB_MAX_ITEMS = 25;
// Renew a little before GitLab's 2-hour tokens run out.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const GITLAB_URL_RE = /^https:\/\/gitlab\.com\/[A-Za-z0-9._~%/#?=&+!-]*$/;
const USERNAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}$/;
const PROJECT_PATH_RE = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*(\/[A-Za-z0-9_.][A-Za-z0-9_.-]*)+$/;

/** Only plain links on the instance may be opened (GitLab data is untrusted). */
export function isSafeGitLabUrl(url, base = GITLAB_HOST) {
    if (base !== GITLAB_HOST)
        return isSafeAccountUrl(url, base);
    return typeof url === 'string' && GITLAB_URL_RE.test(url);
}

export function isValidGitLabUsername(name) {
    return typeof name === 'string' && USERNAME_RE.test(name);
}

function positiveInt(value) {
    return Number.isInteger(value) && value > 0;
}

function capped(value, max) {
    return typeof value === 'string' ? [...value].slice(0, max).join('') : '';
}

/** Device-code response; the links must be the instance's. Null if unusable. */
export function parseGitLabDeviceCode(json, base = GITLAB_HOST) {
    const {device_code: deviceCode, user_code: userCode} = json ?? {};
    if (typeof deviceCode !== 'string' || !deviceCode || typeof userCode !== 'string' ||
        !/^[A-Za-z0-9-]{4,16}$/.test(userCode))
        return null;
    const complete = json.verification_uri_complete;
    return {
        deviceCode,
        userCode,
        verificationUri: isSafeGitLabUrl(complete, base) ? complete
            : isSafeGitLabUrl(json.verification_uri, base) ? json.verification_uri : `${base}/oauth/device`,
        expiresIn: positiveInt(json.expires_in) ? json.expires_in : 300,
        interval: positiveInt(json.interval) ? json.interval : 5,
    };
}

/** {access, refresh, expiresAt} from a token response, or null. */
export function parseGitLabToken(json, nowMs = Date.now()) {
    if (typeof json?.access_token !== 'string' || !json.access_token)
        return null;
    const expiresIn = positiveInt(json.expires_in) ? json.expires_in : 7200;
    return {
        access: json.access_token,
        refresh: typeof json.refresh_token === 'string' ? json.refresh_token : null,
        expiresAt: nowMs + expiresIn * 1000,
    };
}

export function tokenNeedsRefresh(auth, nowMs = Date.now()) {
    return Boolean(auth?.refresh) && nowMs > auth.expiresAt - REFRESH_MARGIN_MS;
}

/** The stored JSON form of {access, refresh, expiresAt}; null if it doesn't parse. */
export function parseStoredAuth(text) {
    try {
        const auth = JSON.parse(text);
        return typeof auth?.access === 'string' && auth.access ? auth : null;
    } catch {
        return null;
    }
}

// Lists. `search` is 'issue', 'mr-assigned' or 'mr-review'.

export function listPath(search, username = null) {
    const common = `state=opened&order_by=updated_at&sort=desc&per_page=${GITLAB_MAX_ITEMS}`;
    switch (search) {
    case 'issue':
        return `/issues?scope=assigned_to_me&${common}`;
    case 'mr-assigned':
        return `/merge_requests?scope=assigned_to_me&${common}`;
    case 'mr-review':
        if (!isValidGitLabUsername(username))
            throw new TypeError('sourceglance: not a valid GitLab username');
        return `/merge_requests?scope=all&reviewer_username=${encodeURIComponent(username)}&${common}`;
    default:
        throw new TypeError(`sourceglance: unknown GitLab list ${search}`);
    }
}

/** Count-only paths for closed issues, and closed plus merged MRs, still assigned to you. */
export function closedCountPaths() {
    return {
        issues: ['/issues?scope=assigned_to_me&state=closed&per_page=1'],
        prs: ['/merge_requests?scope=assigned_to_me&state=closed&per_page=1',
            '/merge_requests?scope=assigned_to_me&state=merged&per_page=1'],
    };
}

/** "group/sub/project#12" or "!12" references → "group/sub/project". */
function projectPath(item) {
    const full = item?.references?.full ?? '';
    const match = /^(.+?)[#!]\d+$/.exec(full);
    return match && PROJECT_PATH_RE.test(match[1]) ? match[1] : null;
}

/** Items from a GitLab issues or merge_requests list. */
export function parseGitLabItems(json, search, base = GITLAB_HOST) {
    const mr = search !== 'issue';
    return (Array.isArray(json) ? json : [])
        .filter(item => positiveInt(item?.iid) && positiveInt(item.project_id) && projectPath(item))
        .map(item => ({
            platform: 'gitlab',
            kind: mr ? 'pr' : 'issue',
            reason: search === 'mr-review' ? 'review' : 'assigned',
            number: item.iid,
            title: capped(item.title, 300),
            url: isSafeGitLabUrl(item.web_url, base) ? item.web_url : null,
            repo: projectPath(item),
            projectId: item.project_id,
            nodeId: null,
            state: item.state === 'opened' ? 'open' : 'closed',
            labels: (Array.isArray(item.labels) ? item.labels : [])
                .filter(name => typeof name === 'string' && name.length > 0 && name.length <= 255)
                .map(name => ({name, color: null})),
            assignees: (Array.isArray(item.assignees) ? item.assignees : [])
                .map(user => user?.username).filter(isValidGitLabUsername),
            assigneeIds: (Array.isArray(item.assignees) ? item.assignees : [])
                .map(user => user?.id).filter(positiveInt),
            comments: Number.isInteger(item.user_notes_count) && item.user_notes_count >= 0 ? item.user_notes_count : 0,
            updatedAt: item.updated_at,
            boards: [],
        }));
}

/** Members who can be assigned: [{id, username}]. */
export function parseGitLabMembers(json) {
    return (Array.isArray(json) ? json : [])
        .filter(user => positiveInt(user?.id) && isValidGitLabUsername(user.username))
        .map(user => ({id: user.id, username: user.username}));
}

/** Labels: [{name, color}]. */
export function parseGitLabLabels(json) {
    return (Array.isArray(json) ? json : [])
        .filter(label => typeof label?.name === 'string' && label.name.length > 0 && label.name.length <= 255)
        .map(label => ({name: label.name, color: /^#[0-9a-fA-F]{6}$/.test(label.color ?? '') ? label.color.slice(1).toLowerCase() : null}));
}

// Write requests, {method, path, body} for GitLabClient.send(). IDs are checked first.

function itemPath(item) {
    if (item?.platform !== 'gitlab' || !positiveInt(item.projectId) || !positiveInt(item.number))
        throw new TypeError('sourceglance: not a valid GitLab issue or merge request');
    return `/projects/${item.projectId}/${item.kind === 'pr' ? 'merge_requests' : 'issues'}/${item.number}`;
}

export function gitlabCloseRequest(item) {
    return {method: 'PUT', path: itemPath(item), body: {state_event: 'close'}};
}

export function gitlabReopenRequest(item) {
    return {method: 'PUT', path: itemPath(item), body: {state_event: 'reopen'}};
}

/** The GET requests for the preview: the issue or merge request, then its notes (oldest first). */
export function gitlabDetailsRequests(item) {
    const path = itemPath(item);
    return {
        item: {method: 'GET', path},
        comments: {method: 'GET', path: `${path}/notes?sort=asc&order_by=created_at&per_page=100`},
    };
}

function username(user) {
    return isValidGitLabUsername(user?.username) ? user.username : null;
}

/** Like parseDetails() in model.js. GitLab lists 👍 and 👎 on the item; notes leave out system notes. */
export function parseGitLabDetails(itemJson, notesJson) {
    const comments = (Array.isArray(notesJson) ? notesJson : [])
        .filter(note => !note?.system && typeof note?.body === 'string')
        .map(note => ({
            author: username(note.author),
            createdAt: typeof note.created_at === 'string' ? note.created_at : null,
            body: capped(note.body, 65536),
            reactions: [],
        }));
    const count = n => (Number.isInteger(n) && n > 0 ? n : 0);
    const reactions = [{emoji: '👍', count: count(itemJson?.upvotes)}, {emoji: '👎', count: count(itemJson?.downvotes)}]
        .filter(reaction => reaction.count > 0);
    const total = Number.isInteger(itemJson?.user_notes_count) ? itemJson.user_notes_count : comments.length;
    return {
        body: capped(itemJson?.description ?? '', 65536),
        author: username(itemJson?.author),
        createdAt: typeof itemJson?.created_at === 'string' ? itemJson.created_at : null,
        reactions,
        comments,
        more: Math.max(0, total - comments.length),
    };
}

export function gitlabBodyRequest(item, text) {
    const description = typeof text === 'string' ? text : '';
    if (description.length > 1000000)
        return null;
    return {method: 'PUT', path: itemPath(item), body: {description}};
}

export function gitlabCommentRequest(item, text) {
    const body = typeof text === 'string' ? text.trim() : '';
    if (!body || body.length > 1000000)
        return null;
    return {method: 'POST', path: `${itemPath(item)}/notes`, body: {body}};
}

/** One request that sets the labels to `wanted` (null if nothing changes). */
export function gitlabLabelsRequest(item, wanted) {
    const current = item.labels.map(label => label.name);
    const add = wanted.filter(name => !current.includes(name));
    const remove = current.filter(name => !wanted.includes(name));
    if (add.length === 0 && remove.length === 0)
        return null;
    const body = {};
    if (add.length)
        body.add_labels = add.join(',');
    if (remove.length)
        body.remove_labels = remove.join(',');
    return {method: 'PUT', path: itemPath(item), body};
}

/** One request that sets the assignees to `wanted` usernames, via `members` [{id, username}]. */
export function gitlabAssigneesRequest(item, wanted, members) {
    const ids = wanted
        .map(name => members.find(member => member.username === name)?.id)
        .filter(positiveInt);
    const same = ids.length === item.assigneeIds.length && ids.every(id => item.assigneeIds.includes(id));
    if (same)
        return null;
    return {method: 'PUT', path: itemPath(item), body: {assignee_ids: ids.length ? ids : [0]}};
}

/** The instance's pages for the list footers. */
export function gitlabClosedPageUrl(kind, username, base = GITLAB_HOST) {
    if (!isValidGitLabUsername(username))
        return `${base}/dashboard/${kind === 'pr' ? 'merge_requests' : 'issues'}`;
    const user = encodeURIComponent(username);
    return kind === 'pr'
        ? `${base}/dashboard/merge_requests?assignee_username=${user}&state=merged`
        : `${base}/dashboard/issues?assignee_username=${user}&state=closed`;
}
