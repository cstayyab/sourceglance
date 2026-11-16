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

export function buildSearchQuery(repos = []) {
    const parts = ['is:open', 'is:issue', 'assignee:@me', 'archived:false'];
    for (const repo of repos) {
        if (isValidRepo(repo))
            parts.push(`repo:${repo}`);
    }
    return parts.join(' ');
}

export function buildSearchPath(repos = []) {
    const q = encodeURIComponent(buildSearchQuery(repos));
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
// takes no scope. The opt-in full-access
// sign-in uses an OAuth App, and reading private issues there needs `repo`: OAuth Apps have
// no read-only scope for that. sourceglance only ever sends GET requests to the API.
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

export function parseSearchResponse(json) {
    const items = Array.isArray(json?.items) ? json.items : [];
    const issues = items
        .filter(item => !item.pull_request)
        .map(item => ({
            number: item.number,
            title: item.title ?? '',
            url: isSafeGitHubUrl(item.html_url) ? item.html_url : null,
            repo: repoFromApiUrl(item.repository_url),
            updatedAt: item.updated_at,
        }));
    return {total: json?.total_count ?? issues.length, issues};
}

/**
 * Group issues by repository. Issues are sorted newest-updated first, and repositories are
 * ordered by their newest issue.
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
 * Kinds: auth (401), forbidden (403), rate-limit, query (422), server (5xx), network, unknown.
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
