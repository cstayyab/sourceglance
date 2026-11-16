// GitLab (gitlab.com) parsing and request building. Pure: no gi:// or resource:// imports,
// unit-tested with Node like model.js (ADR 0004). Items come out in the same shape as GitHub's
// (see parseSearchResponse in model.js) with platform: 'gitlab'; merge requests use kind 'pr'.

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

/** Only plain https://gitlab.com/ links may be opened (GitLab data is untrusted). */
export function isSafeGitLabUrl(url) {
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

/** Device-code response; the links must be gitlab.com's. Null if unusable. */
export function parseGitLabDeviceCode(json) {
    const {device_code: deviceCode, user_code: userCode} = json ?? {};
    if (typeof deviceCode !== 'string' || !deviceCode || typeof userCode !== 'string' ||
        !/^[A-Za-z0-9-]{4,16}$/.test(userCode))
        return null;
    const complete = json.verification_uri_complete;
    return {
        deviceCode,
        userCode,
        verificationUri: isSafeGitLabUrl(complete) ? complete
            : isSafeGitLabUrl(json.verification_uri) ? json.verification_uri : GITLAB_DEVICE_URL,
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
export function parseGitLabItems(json, search) {
    const mr = search !== 'issue';
    return (Array.isArray(json) ? json : [])
        .filter(item => positiveInt(item?.iid) && positiveInt(item.project_id) && projectPath(item))
        .map(item => ({
            platform: 'gitlab',
            kind: mr ? 'pr' : 'issue',
            reason: search === 'mr-review' ? 'review' : 'assigned',
            number: item.iid,
            title: capped(item.title, 300),
            url: isSafeGitLabUrl(item.web_url) ? item.web_url : null,
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

/** gitlab.com pages for the list footers. */
export function gitlabClosedPageUrl(kind, username) {
    if (!isValidGitLabUsername(username))
        return `${GITLAB_HOST}/dashboard/${kind === 'pr' ? 'merge_requests' : 'issues'}`;
    const user = encodeURIComponent(username);
    return kind === 'pr'
        ? `${GITLAB_HOST}/dashboard/merge_requests?assignee_username=${user}&state=merged`
        : `${GITLAB_HOST}/dashboard/issues?assignee_username=${user}&state=closed`;
}
