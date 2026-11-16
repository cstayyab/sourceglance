// Pure logic shared by the Shell and prefs processes.
// No gi:// or resource:// imports here: this module is unit-tested with Node (ADR 0004).

export const MAX_ISSUES = 25;

const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export function isValidRepo(repo) {
    return REPO_RE.test(repo);
}

/**
 * Split comma- or whitespace-separated "owner/name" text into valid and invalid entries.
 */
export function parseRepoList(text) {
    const repos = [];
    const invalid = [];
    for (const entry of text.split(/[\s,]+/)) {
        if (!entry)
            continue;
        if (isValidRepo(entry))
            repos.includes(entry) || repos.push(entry);
        else
            invalid.push(entry);
    }
    return {repos, invalid};
}

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function isValidLogin(login) {
    return typeof login === 'string' && LOGIN_RE.test(login);
}

// What each search lists. PRs come from two searches: assigned to you, and awaiting your review.
const SEARCH_QUALIFIERS = {
    'issue': ['is:issue', 'assignee:@me'],
    'pr-assigned': ['is:pr', 'assignee:@me'],
    'pr-review': ['is:pr', 'review-requested:@me'],
};

export function buildSearchQuery(repos = [], search = 'issue') {
    const parts = ['is:open', ...SEARCH_QUALIFIERS[search], 'archived:false'];
    for (const repo of repos) {
        if (isValidRepo(repo))
            parts.push(`repo:${repo}`);
    }
    return parts.join(' ');
}

export function buildSearchPath(repos = [], search = 'issue') {
    const q = encodeURIComponent(buildSearchQuery(repos, search));
    return `/search/issues?q=${q}&sort=updated&order=desc&per_page=${MAX_ISSUES}`;
}

const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._~%/#?=&+-]*$/;

/**
 * Only plain https://github.com/ links may be opened from the menu (threat model T7):
 * API data is untrusted, and opening other schemes could launch arbitrary handlers.
 */
export function isSafeGitHubUrl(url) {
    return typeof url === 'string' && GITHUB_URL_RE.test(url);
}

// OAuth device flow (https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).
// The default sign-in is a GitHub App limited to issues, pull requests and projects; it
// takes no scope. The opt-in full-access sign-in uses an OAuth App, and reading private
// issues there needs `repo`: OAuth Apps have no narrower scope for that.
export const FULL_ACCESS_SCOPE = 'repo';
export const DEVICE_VERIFICATION_URL = 'https://github.com/login/device';
export const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

/** Page where the user picks which repositories a GitHub App may read, or null for a bad slug. */
export function appInstallUrl(slug) {
    return /^[a-z0-9](?:[a-z0-9-]{0,33}[a-z0-9])?$/.test(slug ?? '')
        ? `https://github.com/apps/${slug}/installations/new`
        : null;
}

/** application/x-www-form-urlencoded body from a plain object. */
export function formEncode(fields) {
    return Object.entries(fields)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
}

/**
 * Validate GitHub's device-code response. Returns null if it is unusable. The verification
 * link is untrusted data, so anything other than a github.com link falls back to the known one.
 */
export function parseDeviceCodeResponse(json) {
    const {device_code: deviceCode, user_code: userCode} = json ?? {};
    if (typeof deviceCode !== 'string' || !deviceCode ||
        typeof userCode !== 'string' || !/^[A-Z0-9-]{4,16}$/.test(userCode))
        return null;
    const uri = json.verification_uri;
    return {
        deviceCode,
        userCode,
        verificationUri: isSafeGitHubUrl(uri) ? uri : DEVICE_VERIFICATION_URL,
        expiresIn: positiveInt(json.expires_in, 900),
        interval: positiveInt(json.interval, 5),
    };
}

function positiveInt(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Classify one poll of the device-flow token endpoint. GitHub answers HTTP 200 with an
 * `error` field while waiting.
 *
 * States: done (with token), pending, slow-down (with the new interval), expired, denied, error.
 */
export function classifyDeviceTokenResponse(json, interval) {
    if (typeof json?.access_token === 'string' && json.access_token)
        return {state: 'done', token: json.access_token};
    switch (json?.error) {
    case 'authorization_pending':
        return {state: 'pending', interval};
    case 'slow_down':
        // GitHub sends the new interval; otherwise add the 5 s the spec asks for.
        return {state: 'slow-down', interval: positiveInt(json.interval, interval + 5)};
    case 'expired_token':
        return {state: 'expired'};
    case 'access_denied':
        return {state: 'denied'};
    default:
        return {state: 'error', error: typeof json?.error === 'string' ? json.error : 'unknown'};
    }
}

/** "https://api.github.com/repos/owner/name" → "owner/name" */
export function repoFromApiUrl(url) {
    const match = /\/repos\/([^/]+\/[^/]+)$/.exec(url ?? '');
    return match ? match[1] : 'unknown';
}

function cappedString(value, max) {
    return typeof value === 'string' ? [...value].slice(0, max).join('') : '';
}

/** Labels from API data: [{name, color}], dropping malformed entries. */
export function parseLabels(list) {
    if (!Array.isArray(list))
        return [];
    return list
        .filter(label => typeof label?.name === 'string' && label.name.length > 0 && label.name.length <= 100)
        .map(label => ({
            name: label.name,
            color: /^[0-9a-fA-F]{6}$/.test(label.color ?? '') ? label.color.toLowerCase() : null,
        }));
}

/** Logins from a list of API users, dropping anything that isn't a valid login. */
export function parseLogins(list) {
    if (!Array.isArray(list))
        return [];
    return list.map(user => user?.login).filter(isValidLogin);
}

/**
 * Items from a search response. `search` is the search that produced it ('issue',
 * 'pr-assigned' or 'pr-review'); items of the other kind are dropped.
 */
export function parseSearchResponse(json, search = 'issue') {
    const wantPr = search !== 'issue';
    const raw = Array.isArray(json?.items) ? json.items : [];
    const items = raw
        .filter(item => Boolean(item?.pull_request) === wantPr && Number.isInteger(item.number))
        .map(item => ({
            kind: wantPr ? 'pr' : 'issue',
            reason: search === 'pr-review' ? 'review' : 'assigned',
            number: item.number,
            title: cappedString(item.title, 300),
            url: isSafeGitHubUrl(item.html_url) ? item.html_url : null,
            repo: repoFromApiUrl(item.repository_url),
            nodeId: cappedString(item.node_id, 100) || null,
            state: item.state === 'closed' ? 'closed' : 'open',
            labels: parseLabels(item.labels),
            assignees: parseLogins(item.assignees),
            updatedAt: item.updated_at,
        }));
    return {total: json?.total_count ?? items.length, items};
}

/**
 * Merge item lists, keeping the first copy of each (by repo and number). Used to combine the
 * "assigned" and "review requested" PR searches; a PR in both keeps reason 'assigned'.
 */
export function mergeItems(...lists) {
    const seen = new Map();
    for (const item of lists.flat()) {
        const key = itemKey(item);
        if (!seen.has(key))
            seen.set(key, item);
    }
    return [...seen.values()];
}

/** Stable identity of an issue or PR: "owner/name#number". */
export function itemKey(item) {
    return `${item.repo}#${item.number}`;
}

// Write requests. Each builder returns {method, path, body} for GitHubClient.send(), after
// checking the parts that end up in the URL: API data is untrusted (threat model T7).

export const MAX_COMMENT_LENGTH = 65536;

function issuePath(item) {
    if (!isValidRepo(item?.repo) || !Number.isInteger(item.number) || item.number <= 0)
        throw new TypeError('sourceglance: not a valid issue or pull request');
    return `/repos/${item.repo}/issues/${item.number}`;
}

/** Close an issue (reason 'completed' or 'not_planned') or a pull request. */
export function closeRequest(item, reason = 'completed') {
    const path = issuePath(item);
    if (item.kind === 'pr')
        return {method: 'PATCH', path: path.replace('/issues/', '/pulls/'), body: {state: 'closed'}};
    if (reason !== 'completed' && reason !== 'not_planned')
        throw new TypeError(`sourceglance: unknown close reason ${reason}`);
    return {method: 'PATCH', path, body: {state: 'closed', state_reason: reason}};
}

export function reopenRequest(item) {
    const path = issuePath(item);
    if (item.kind === 'pr')
        return {method: 'PATCH', path: path.replace('/issues/', '/pulls/'), body: {state: 'open'}};
    return {method: 'PATCH', path, body: {state: 'open', state_reason: 'reopened'}};
}

/** Returns null for an empty or too long comment, so the dialog can keep Post disabled. */
export function commentRequest(item, text) {
    const path = issuePath(item);
    const body = typeof text === 'string' ? text.trim() : '';
    if (!body || body.length > MAX_COMMENT_LENGTH)
        return null;
    return {method: 'POST', path: `${path}/comments`, body: {body}};
}

/** Add (add=true) or remove assignees. Invalid logins are dropped; null if none are left. */
export function assigneesRequest(item, logins, add) {
    const path = issuePath(item);
    const valid = [...new Set(logins)].filter(isValidLogin);
    if (valid.length === 0)
        return null;
    return {method: add ? 'POST' : 'DELETE', path: `${path}/assignees`, body: {assignees: valid}};
}

function isValidLabelName(name) {
    return typeof name === 'string' && name.length > 0 && name.length <= 100;
}

export function addLabelsRequest(item, names) {
    const path = issuePath(item);
    const valid = [...new Set(names)].filter(isValidLabelName);
    if (valid.length === 0)
        return null;
    return {method: 'POST', path: `${path}/labels`, body: {labels: valid}};
}

export function removeLabelRequest(item, name) {
    const path = issuePath(item);
    if (!isValidLabelName(name))
        throw new TypeError('sourceglance: not a valid label name');
    return {method: 'DELETE', path: `${path}/labels/${encodeURIComponent(name)}`, body: null};
}

/**
 * The requests that turn `current` into `wanted` (both arrays of names), for the picker
 * dialogs. Kept in order: additions first, then removals.
 */
export function diffSelection(current, wanted) {
    const before = new Set(current);
    const after = new Set(wanted);
    return {
        add: [...after].filter(name => !before.has(name)),
        remove: [...before].filter(name => !after.has(name)),
    };
}

/**
 * Group items by repository. Items are sorted newest-updated first, and repositories are
 * ordered by their newest item.
 */
export function groupIssues(issues) {
    const sorted = [...issues].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const groups = new Map();
    for (const issue of sorted) {
        if (!groups.has(issue.repo))
            groups.set(issue.repo, []);
        groups.get(issue.repo).push(issue);
    }
    return [...groups].map(([repo, list]) => ({repo, issues: list}));
}

/**
 * Map a non-200 HTTP response to an error kind. `headers` is a plain object with lowercase
 * header names. Status 0 means the request never got a response.
 *
 * Kinds: auth (401), forbidden (403), not-found (404), gone (410), rate-limit, query (422),
 * server (5xx), network, unknown.
 */
export function classifyHttpError(status, headers = {}, nowMs = Date.now()) {
    const retryAfter = Number.parseInt(headers['retry-after'], 10);
    const remaining = headers['x-ratelimit-remaining'];
    const reset = Number.parseInt(headers['x-ratelimit-reset'], 10);

    if ((status === 403 || status === 429) && (remaining === '0' || !Number.isNaN(retryAfter))) {
        let retryAt = null;
        if (!Number.isNaN(retryAfter))
            retryAt = nowMs + retryAfter * 1000;
        else if (!Number.isNaN(reset))
            retryAt = reset * 1000;
        return {kind: 'rate-limit', status, retryAt};
    }
    if (status === 401)
        return {kind: 'auth', status, retryAt: null};
    if (status === 403)
        return {kind: 'forbidden', status, retryAt: null};
    if (status === 404)
        return {kind: 'not-found', status, retryAt: null};
    if (status === 410)
        return {kind: 'gone', status, retryAt: null};
    if (status === 422)
        return {kind: 'query', status, retryAt: null};
    if (status >= 500)
        return {kind: 'server', status, retryAt: null};
    if (status === 0)
        return {kind: 'network', status, retryAt: null};
    return {kind: 'unknown', status, retryAt: null};
}

/** Seconds until the next automatic refresh, honouring a rate-limit reset time. */
export function nextRefreshDelaySeconds(intervalMinutes, error = null, nowMs = Date.now()) {
    const interval = Math.max(1, intervalMinutes) * 60;
    if (error?.kind === 'rate-limit' && error.retryAt)
        return Math.max(60, Math.ceil((error.retryAt - nowMs) / 1000));
    return interval;
}

/** Relative time as {unit, value}; the UI turns it into a translated string. */
export function relativeTime(date, nowMs = Date.now()) {
    const seconds = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
    if (seconds < 60)
        return {unit: 'now', value: 0};
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return {unit: 'minute', value: minutes};
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return {unit: 'hour', value: hours};
    return {unit: 'day', value: Math.floor(hours / 24)};
}

export function truncate(text, max = 48) {
    const chars = [...text];
    return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

/** Text for the panel badge: '' (hidden), '7', or '25+' when results were cut off. */
export function countLabel(total, shown) {
    if (!total)
        return '';
    return total > shown ? `${shown}+` : String(total);
}
