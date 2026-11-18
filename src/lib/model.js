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
// The closed searches only count what's closed but still assigned to you (the list footers).
const SEARCH_QUALIFIERS = {
    'issue': ['is:open', 'is:issue', 'assignee:@me'],
    'pr-assigned': ['is:open', 'is:pr', 'assignee:@me'],
    'pr-review': ['is:open', 'is:pr', 'review-requested:@me'],
    'issue-closed': ['is:closed', 'is:issue', 'assignee:@me'],
    'pr-closed': ['is:closed', 'is:pr', 'assignee:@me'],
};

export function buildSearchQuery(repos = [], search = 'issue') {
    const parts = [...SEARCH_QUALIFIERS[search], 'archived:false'];
    for (const repo of repos) {
        if (isValidRepo(repo))
            parts.push(`repo:${repo}`);
    }
    return parts.join(' ');
}

export function buildSearchPath(repos = [], search = 'issue') {
    const q = encodeURIComponent(buildSearchQuery(repos, search));
    // Count-only searches need no items, just total_count.
    const perPage = search.endsWith('-closed') ? 1 : MAX_ISSUES;
    return `/search/issues?q=${q}&sort=updated&order=desc&per_page=${perPage}`;
}

/**
 * Page listing what a search finds, for "View on GitHub" links and list footers. `base` is
 * the instance (GitHub Enterprise Server has the same pages).
 */
export function searchPageUrl(search, repos = [], base = 'https://github.com') {
    const page = search.startsWith('pr') ? 'pulls' : 'issues';
    return `${base}/${page}?q=${encodeURIComponent(buildSearchQuery(repos, search))}`;
}

// The lists that can have a top-bar button, in their fixed order. The sourceglance button
// (status and settings) is always shown and isn't part of this setting.
export const TOOLBAR_LISTS = ['issues', 'prs', 'projects'];

/** Known list ids from the `toolbar-buttons` setting, in toolbar order, without duplicates. */
export function normalizeButtons(ids) {
    const wanted = new Set(Array.isArray(ids) ? ids : []);
    return TOOLBAR_LISTS.filter(id => wanted.has(id));
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
// issues there needs `repo`: OAuth Apps have no narrower scope for that. `project` lets it
// read and move items on project boards.
export const FULL_ACCESS_SCOPE = 'repo project';
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
 * link is untrusted data, so anything other than a link on the instance (`isSafe`) falls back
 * to the known one (`fallback`).
 */
export function parseDeviceCodeResponse(json, {isSafe = isSafeGitHubUrl, fallback = DEVICE_VERIFICATION_URL} = {}) {
    const {device_code: deviceCode, user_code: userCode} = json ?? {};
    if (typeof deviceCode !== 'string' || !deviceCode ||
        typeof userCode !== 'string' || !/^[A-Z0-9-]{4,16}$/.test(userCode))
        return null;
    const uri = json.verification_uri;
    return {
        deviceCode,
        userCode,
        verificationUri: isSafe(uri) ? uri : fallback,
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

// Desktop widgets (lib/widgets.js): which cards, and where they go.
export const WIDGET_IDS = ['summary', 'issues', 'prs', 'projects'];
export const WIDGET_WIDTH = 320;
const WIDGET_MARGIN = 24;
const WIDGET_GAP = 16;

/** Known card ids from the `widgets` setting, in display order, without duplicates. */
export function normalizeWidgets(ids) {
    const wanted = new Set(Array.isArray(ids) ? ids : []);
    return WIDGET_IDS.filter(id => wanted.has(id));
}

/**
 * Default spot for the index-th card: a column at the right edge of the work area, top down.
 * `area` is {x, y, width, height}; `heights` are the heights of the cards above it.
 */
export function defaultWidgetPosition(area, heights) {
    const y = area.y + WIDGET_MARGIN + heights.reduce((sum, h) => sum + h + WIDGET_GAP, 0);
    return {x: area.x + area.width - WIDGET_WIDTH - WIDGET_MARGIN, y};
}

/** Keeps a card fully inside the work area (a saved spot may be off a now-smaller screen). */
export function clampWidgetPosition({x, y}, area, size) {
    const maxX = area.x + Math.max(0, area.width - size.width);
    const maxY = area.y + Math.max(0, area.height - size.height);
    return {
        x: Math.round(Math.min(Math.max(x, area.x), maxX)),
        y: Math.round(Math.min(Math.max(y, area.y), maxY)),
    };
}

// The app grid launcher ("Open sourceglance"), written by the extension (appLauncher.js).
export const LAUNCHER_ID = 'io.github.omer_gh.sourceglance';

/** Quotes a path for a desktop entry's Exec key (Desktop Entry spec, "Exec key"). */
function quoteExecArg(arg) {
    return `"${arg.replace(/[\\"`$]/g, char => `\\${char}`)}"`;
}

/**
 * The launcher's .desktop file. It runs launcher.js with gjs, which starts sourceglance (also
 * after Quit) and opens its Settings. Desktop entry values escape backslashes once more.
 */
export function launcherDesktopEntry({launcherPath, iconPath}) {
    const exec = ['gjs', '-m', quoteExecArg(launcherPath)].join(' ').replace(/\\/g, '\\\\');
    return [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Source Glance',
        'Comment=Your GitHub issues, pull requests and project boards in the top bar',
        `Exec=${exec}`,
        `Icon=${iconPath}`,
        'Terminal=false',
        'Categories=Development;',
        'Keywords=GitHub;issues;pull requests;projects;',
        'StartupNotify=false',
        '',
    ].join('\n');
}

/**
 * A GType name unique to one copy of a module. GTypes can't be registered twice, and
 * `make reload` loads each build from a new URL, so names include a hash of that URL.
 */
export function gtypeName(name, moduleUrl) {
    let hash = 0x811c9dc5;
    for (const char of moduleUrl) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `Sourceglance_${name}_${hash.toString(16).padStart(8, '0')}`;
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
 * 'pr-assigned' or 'pr-review'); items of the other kind are dropped. `isSafeUrl` checks
 * links (github.com by default; the account's instance for GitHub Enterprise Server).
 */
export function parseSearchResponse(json, search = 'issue', isSafeUrl = isSafeGitHubUrl) {
    const wantPr = search !== 'issue';
    const raw = Array.isArray(json?.items) ? json.items : [];
    const items = raw
        .filter(item => Boolean(item?.pull_request) === wantPr && Number.isInteger(item.number))
        .map(item => ({
            kind: wantPr ? 'pr' : 'issue',
            reason: search === 'pr-review' ? 'review' : 'assigned',
            number: item.number,
            title: cappedString(item.title, 300),
            url: isSafeUrl(item.html_url) ? item.html_url : null,
            repo: repoFromApiUrl(item.repository_url),
            nodeId: cappedString(item.node_id, 100) || null,
            state: item.state === 'closed' ? 'closed' : 'open',
            labels: parseLabels(item.labels),
            assignees: parseLogins(item.assignees),
            comments: Number.isInteger(item.comments) && item.comments >= 0 ? item.comments : 0,
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

/**
 * Stable identity of an issue or PR: "owner/name#number". Items of accounts added since
 * multiple accounts (anything but the github.com and gitlab.com ids) are prefixed with the
 * account id, since two accounts can list the same item.
 */
export function itemKey(item) {
    // GitLab paths can match GitHub ones, and issue #3 and merge request !3 differ.
    const key = item.platform === 'gitlab'
        ? `gitlab:${item.repo}${item.kind === 'pr' ? '!' : '#'}${item.number}`
        : `${item.repo}#${item.number}`;
    return item.accountId && item.accountId !== 'github.com' && item.accountId !== 'gitlab.com'
        ? `${item.accountId}|${key}` : key;
}

/** "#12" for issues and GitHub PRs, "!12" for GitLab merge requests. */
export function itemRef(item) {
    return `${item.platform === 'gitlab' && item.kind === 'pr' ? '!' : '#'}${item.number}`;
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

// The preview: an item's description, comments and reactions, and editing the description.

export const MAX_PREVIEW_COMMENTS = 100;
const MAX_BODY_LENGTH = 65536;

// GitHub's reaction names → what the preview shows.
const REACTIONS = [['+1', '👍'], ['-1', '👎'], ['laugh', '😄'], ['hooray', '🎉'], ['confused', '😕'],
    ['heart', '❤️'], ['rocket', '🚀'], ['eyes', '👀']];

/** A GitHub `reactions` summary → [{emoji, count}] for the ones used, in GitHub's order. */
export function parseReactions(summary) {
    return REACTIONS
        .map(([name, emoji]) => ({emoji, count: Number.isInteger(summary?.[name]) ? summary[name] : 0}))
        .filter(reaction => reaction.count > 0);
}

function parseLogin(user) {
    return isValidLogin(user?.login) ? user.login : null;
}

/** The GET requests for the preview of an issue or pull request: the item, then its comments. */
export function detailsRequests(item) {
    const path = issuePath(item);
    return {
        item: {method: 'GET', path},
        comments: {method: 'GET', path: `${path}/comments?per_page=${MAX_PREVIEW_COMMENTS}`},
    };
}

/**
 * The preview from the API's issue and comments: {body, author, createdAt, reactions,
 * comments: [{author, createdAt, body, reactions}], more}. Text stays plain (shown as is).
 */
export function parseDetails(itemJson, commentsJson) {
    const comments = (Array.isArray(commentsJson) ? commentsJson : [])
        .filter(comment => typeof comment?.body === 'string')
        .map(comment => ({
            author: parseLogin(comment.user),
            createdAt: typeof comment.created_at === 'string' ? comment.created_at : null,
            body: cappedString(comment.body, MAX_BODY_LENGTH),
            reactions: parseReactions(comment.reactions),
        }));
    const total = Number.isInteger(itemJson?.comments) ? itemJson.comments : comments.length;
    return {
        body: cappedString(itemJson?.body ?? '', MAX_BODY_LENGTH),
        author: parseLogin(itemJson?.user),
        createdAt: typeof itemJson?.created_at === 'string' ? itemJson.created_at : null,
        reactions: parseReactions(itemJson?.reactions),
        comments,
        more: Math.max(0, total - comments.length),
    };
}

/** Replaces an issue's or pull request's description (empty clears it). */
export function bodyRequest(item, text) {
    const body = typeof text === 'string' ? text : '';
    if (body.length > MAX_BODY_LENGTH)
        return null;
    return {method: 'PATCH', path: issuePath(item), body: {body}};
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

// Projects (v2) are GraphQL-only. Each issue/PR in the list shows its status on every open
// board it's on, from the board's single-select "Status" field.

const PROJECT_ITEM_FIELDS = `
    id
    project {
        id
        title
        closed
        field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
    }
    fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId name } }`;

export const PROJECT_ITEMS_QUERY = `query($ids: [ID!]!) {
    nodes(ids: $ids) {
        ... on Issue { id projectItems(first: 10) { nodes { ${PROJECT_ITEM_FIELDS} } } }
        ... on PullRequest { id projectItems(first: 10) { nodes { ${PROJECT_ITEM_FIELDS} } } }
    }
}`;

const MOVE_STATUS_MUTATION = `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
    updateProjectV2ItemFieldValue(input: {
        projectId: $project, itemId: $item, fieldId: $field, value: {singleSelectOptionId: $option}
    }) { projectV2Item { id } }
}`;

const DRAFT_ASSIGNEES_MUTATION = `mutation($draft: ID!, $assignees: [ID!]) {
    updateProjectV2DraftIssue(input: {draftIssueId: $draft, assigneeIds: $assignees}) { draftIssue { id } }
}`;

function isNodeId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9_=-]{1,100}$/.test(id);
}

/** GraphQL request for the boards of up to 100 items. Null when there's nothing to ask. */
export function projectItemsRequest(nodeIds) {
    const ids = [...new Set(nodeIds)].filter(isNodeId).slice(0, 100);
    if (ids.length === 0)
        return null;
    return {method: 'POST', path: '/graphql', graphql: true, body: {query: PROJECT_ITEMS_QUERY, variables: {ids}}};
}

/**
 * Map of item node ID → boards [{itemId, projectId, title, fieldId, options, optionId, status}].
 * Tolerant: GitHub returns partial data (with `errors`) for boards the sign-in can't see,
 * and those are simply left out. Closed boards and boards without a Status field are skipped.
 */
export function parseProjectItems(json) {
    const boards = new Map();
    const nodes = Array.isArray(json?.data?.nodes) ? json.data.nodes : [];
    for (const node of nodes) {
        if (!isNodeId(node?.id))
            continue;
        const list = [];
        for (const entry of node.projectItems?.nodes ?? []) {
            const project = entry?.project;
            const field = project?.field;
            if (!isNodeId(entry?.id) || !isNodeId(project?.id) || project.closed || !isNodeId(field?.id))
                continue;
            const options = (field.options ?? [])
                .filter(option => isNodeId(option?.id) && typeof option.name === 'string')
                .map(option => ({id: option.id, name: cappedString(option.name, 100)}));
            const value = entry.fieldValueByName;
            const current = options.find(option => option.id === value?.optionId) ?? null;
            list.push({
                itemId: entry.id,
                projectId: project.id,
                title: cappedString(project.title, 100),
                fieldId: field.id,
                options,
                optionId: current?.id ?? null,
                status: current?.name ?? null,
            });
        }
        boards.set(node.id, list);
    }
    return boards;
}

// The Projects list: your boards (personal and from your organizations) and their draft
// items, i.e. cards that are neither issues nor PRs (those have their own lists).

export const MAX_BOARD_ITEMS = 50;

const BOARD_FIELDS = `
    id
    title
    url
    closed
    field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
    items(first: ${MAX_BOARD_ITEMS}) {
        totalCount
        nodes {
            id
            type
            isArchived
            content { ... on DraftIssue { id title assignees(first: 10) { nodes { id login } } } }
            fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId name } }
        }
    }`;

export const VIEWER_BOARDS_QUERY = `query {
    viewer {
        id
        login
        projectsV2(first: 20) { nodes { ${BOARD_FIELDS} } }
        organizations(first: 20) { nodes { projectsV2(first: 20) { nodes { ${BOARD_FIELDS} } } } }
    }
}`;

export function viewerBoardsRequest() {
    return {method: 'POST', path: '/graphql', graphql: true, body: {query: VIEWER_BOARDS_QUERY, variables: {}}};
}

/** GraphQL users as [{id, login}], dropping malformed entries. */
function parsePeople(list) {
    return (Array.isArray(list) ? list : [])
        .filter(user => isNodeId(user?.id) && isValidLogin(user.login))
        .map(user => ({id: user.id, login: user.login}));
}

function parseBoard(project, isSafeUrl, viewer) {
    const field = project?.field;
    if (!isNodeId(project?.id) || project.closed)
        return null;
    const options = isNodeId(field?.id)
        ? (field.options ?? [])
            .filter(option => isNodeId(option?.id) && typeof option.name === 'string')
            .map(option => ({id: option.id, name: cappedString(option.name, 100)}))
        : [];
    const title = cappedString(project.title, 100);
    const drafts = [];
    for (const node of project.items?.nodes ?? []) {
        if (node?.type !== 'DRAFT_ISSUE' || node.isArchived || !isNodeId(node.id))
            continue;
        const current = options.find(option => option.id === node.fieldValueByName?.optionId) ?? null;
        drafts.push({
            itemId: node.id,
            draftId: isNodeId(node.content?.id) ? node.content.id : null,
            title: cappedString(node.content?.title, 300),
            assignees: parsePeople(node.content?.assignees?.nodes),
            optionId: current?.id ?? null,
            status: current?.name ?? null,
        });
    }
    return {
        projectId: project.id,
        title,
        url: isSafeUrl(project.url) ? project.url : null,
        fieldId: isNodeId(field?.id) ? field.id : null,
        options,
        drafts,
        // You, so a draft can be assigned to you: drafts have no repository to list people from.
        viewer,
        // Items past the first page (of any kind) may hide more drafts.
        truncated: (project.items?.totalCount ?? 0) > MAX_BOARD_ITEMS,
    };
}

/**
 * Boards from VIEWER_BOARDS_QUERY: open boards with their non-archived draft items. Tolerant of
 * partial data (`errors` for boards the sign-in can't read); duplicates are dropped.
 */
export function parseViewerBoards(json, isSafeUrl = isSafeGitHubUrl) {
    const viewer = json?.data?.viewer;
    const projects = [
        ...(viewer?.projectsV2?.nodes ?? []),
        ...(viewer?.organizations?.nodes ?? []).flatMap(org => org?.projectsV2?.nodes ?? []),
    ];
    const viewerUser = parsePeople([viewer])[0] ?? null;
    const seen = new Set();
    const boards = [];
    for (const project of projects) {
        const board = parseBoard(project, isSafeUrl, viewerUser);
        if (board && !seen.has(board.projectId)) {
            seen.add(board.projectId);
            boards.push(board);
        }
    }
    return boards;
}

/**
 * A draft item as an action target, plus the board shape moveStatusRequest() takes. Drafts
 * have no repository or number; their item ID stands in for both in itemKey().
 */
export function draftTarget(board, draft) {
    return {
        item: {
            kind: 'draft', repo: 'project', number: draft.itemId, draftId: draft.draftId ?? null, title: draft.title,
            labels: [], assignees: (draft.assignees ?? []).map(user => user.login), accountId: board.accountId ?? null,
            // Who can be assigned: you and the current assignees, with their node IDs.
            people: [...(board.viewer ? [board.viewer] : []), ...(draft.assignees ?? [])]
                .filter((user, i, all) => all.findIndex(other => other.id === user.id) === i),
        },
        board: {
            itemId: draft.itemId,
            projectId: board.projectId,
            fieldId: board.fieldId,
            options: board.options,
            optionId: draft.optionId,
            status: draft.status,
            title: board.title,
        },
    };
}

/** True for a board column that means finished (Done, Closed, Complete, Completed). */
export function isDoneStatus(name) {
    return typeof name === 'string' && /^\s*(done|closed|complete|completed)\s*$/i.test(name);
}

/** Draft items of a board grouped by status, in the board's column order; "No status" last. */
export function groupDraftsByStatus(board) {
    const groups = board.options
        .map(option => ({status: option.name, drafts: board.drafts.filter(d => d.optionId === option.id)}))
        .filter(group => group.drafts.length > 0);
    const unset = board.drafts.filter(d => d.optionId === null);
    if (unset.length > 0)
        groups.push({status: null, drafts: unset});
    return groups;
}

/** Move a board item to another Status option. The option must be one of the board's own. */
export function moveStatusRequest(board, optionId) {
    if (!isNodeId(board?.itemId) || !isNodeId(board.projectId) || !isNodeId(board.fieldId) ||
        !board.options?.some(option => option.id === optionId))
        throw new TypeError('sourceglance: not a valid project status change');
    return {
        method: 'POST',
        path: '/graphql',
        graphql: true,
        body: {
            query: MOVE_STATUS_MUTATION,
            variables: {project: board.projectId, item: board.itemId, field: board.fieldId, option: optionId},
        },
    };
}

const DRAFT_BODY_QUERY = 'query($draft: ID!) { node(id: $draft) { ... on DraftIssue { body creator { login } createdAt } } }';
const DRAFT_BODY_MUTATION = `mutation($draft: ID!, $body: String!) {
    updateProjectV2DraftIssue(input: {draftIssueId: $draft, body: $body}) { draftIssue { id } }
}`;

function draftId(item) {
    if (item?.kind !== 'draft' || !isNodeId(item.draftId))
        throw new TypeError('sourceglance: not a valid draft item');
    return item.draftId;
}

/** The preview of a draft: its description only (drafts have no comments or reactions). */
export function draftDetailsRequest(item) {
    return {method: 'POST', path: '/graphql', graphql: true,
        body: {query: DRAFT_BODY_QUERY, variables: {draft: draftId(item)}}};
}

export function parseDraftDetails(json) {
    const node = json?.data?.node;
    return {
        body: cappedString(node?.body ?? '', MAX_BODY_LENGTH),
        author: parseLogin(node?.creator),
        createdAt: typeof node?.createdAt === 'string' ? node.createdAt : null,
        reactions: [],
        comments: [],
        more: 0,
    };
}

export function draftBodyRequest(item, text) {
    const body = typeof text === 'string' ? text : '';
    if (body.length > MAX_BODY_LENGTH)
        return null;
    return {method: 'POST', path: '/graphql', graphql: true,
        body: {query: DRAFT_BODY_MUTATION, variables: {draft: draftId(item), body}}};
}

/** Sets a draft item's assignees to `wanted` logins, from its `people`. Null if nothing changes. */
export function draftAssigneesRequest(item, wanted) {
    if (item?.kind !== 'draft' || !isNodeId(item.draftId))
        throw new TypeError('sourceglance: not a valid draft item');
    const {add, remove} = diffSelection(item.assignees, wanted);
    if (add.length === 0 && remove.length === 0)
        return null;
    const ids = wanted.map(login => item.people.find(user => user.login === login)?.id).filter(isNodeId);
    return {
        method: 'POST',
        path: '/graphql',
        graphql: true,
        body: {query: DRAFT_ASSIGNEES_MUTATION, variables: {draft: item.draftId, assignees: ids}},
    };
}

/** Text colour that reads on a label of colour `hex` ("rrggbb"): dark on light labels, else light. */
export function labelTextColor(hex) {
    if (!/^[0-9a-fA-F]{6}$/.test(hex ?? ''))
        return null;
    const [r, g, b] = [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1f2328' : '#ffffff';
}

/** Error kind for a GraphQL `errors` array (GitHub answers HTTP 200 with these). */
export function classifyGraphqlErrors(errors) {
    const type = Array.isArray(errors) ? errors[0]?.type : null;
    switch (type) {
    case 'FORBIDDEN':
    case 'INSUFFICIENT_SCOPES':
        return 'forbidden';
    case 'NOT_FOUND':
        return 'not-found';
    case 'RATE_LIMITED':
        return 'rate-limit';
    default:
        return 'query';
    }
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

/** Labels used by the grouped items, as [{name, count}] sorted by name, for the label filter. */
export function labelOptions(groups) {
    const counts = new Map();
    for (const group of groups) {
        for (const item of group.issues) {
            for (const name of new Set(item.labels.map(label => label.name)))
                counts.set(name, (counts.get(name) ?? 0) + 1);
        }
    }
    return [...counts]
        .map(([name, count]) => ({name, count}))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Keeps only items with the label (null keeps everything), dropping repositories left empty. */
export function filterByLabel(groups, label) {
    if (label === null)
        return groups;
    return groups
        .map(group => ({...group, issues: group.issues.filter(item => item.labels.some(l => l.name === label))}))
        .filter(group => group.issues.length > 0);
}

// Picker flows shared by the top-bar menus (lib/actions.js) and the window (window/actions.js).

/**
 * Logins to offer in the Assignees picker: you first (you can always assign yourself), then
 * current assignees, then the repository's assignable users.
 */
export function assigneeChoices(item, me, assignable) {
    return [...new Set([...(isValidLogin(me) ? [me] : []), ...item.assignees, ...assignable])];
}

/** Requests that change the item's assignees to `wanted` (additions first). */
export function assigneeChangeRequests(item, wanted) {
    const {add, remove} = diffSelection(item.assignees, wanted);
    return [
        add.length ? assigneesRequest(item, add, true) : null,
        remove.length ? assigneesRequest(item, remove, false) : null,
    ].filter(Boolean);
}

/** Label names to offer: the item's current labels, then the repository's. */
export function labelChoices(item, repoLabels) {
    return [...new Set([...item.labels.map(label => label.name), ...repoLabels.map(label => label.name)])];
}

/** Requests that change the item's labels to `wanted` (one add, then one remove per label). */
export function labelChangeRequests(item, wanted) {
    const {add, remove} = diffSelection(item.labels.map(label => label.name), wanted);
    return [
        add.length ? addLabelsRequest(item, add) : null,
        ...remove.map(name => removeLabelRequest(item, name)),
    ].filter(Boolean);
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

/** True once a source (one account's lists, see sourceFrom() in accounts.js) has loaded. */
function sourceLoaded(source) {
    return (source.status === 'ready' || source.status === 'error') && Boolean(source.updatedAt);
}

/**
 * Count for a list's top-bar button, tab or sidebar row: '0' included once loaded; ''
 * hides it (signed out, or not loaded yet). `state.sources` holds each account's lists
 * (status, updatedAt, issueTotal/Shown, prTotal/Shown, boards, boardsError); the count adds
 * them up.
 */
export function listBadge(id, state) {
    const loaded = (state.sources ?? []).filter(sourceLoaded);
    if (loaded.length === 0)
        return '';
    const sum = (total, shown) => countLabel(loaded.reduce((n, source) => n + source[total], 0),
        loaded.reduce((n, source) => n + source[shown], 0)) || '0';
    switch (id) {
    case 'issues':
        return sum('issueTotal', 'issueShown');
    case 'prs':
        return sum('prTotal', 'prShown');
    case 'tasks':
        return String(allTasks(loaded).length);
    case 'projects': {
        // Project boards are GitHub's; accounts that can't read them don't count.
        const boards = loaded.filter(source => source.platform === 'github' && !source.boardsError);
        if (boards.length === 0)
            return '';
        if (boards.some(source => source.boards === null))
            return '…';
        return String(boards.reduce((n, source) => n + source.boards.reduce((m, board) => m + board.drafts.length, 0), 0));
    }
    default:
        return '';
    }
}

/** The count for one account's section of a list. */
export function sourceBadge(id, source) {
    return listBadge(id, {sources: [source]});
}

/** Text for the panel badge: '' (hidden), '7', or '25+' when results were cut off. */
export function countLabel(total, shown) {
    if (!total)
        return '';
    return total > shown ? `${shown}+` : String(total);
}

// Search in the window: one query filters Issues, Pull requests and Projects.

/** Search box text → lowercase words; every word has to match. */
export function searchTerms(query) {
    return String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesAll(text, terms) {
    const haystack = text.toLowerCase();
    return terms.every(term => haystack.includes(term));
}

/** Does an issue or pull request match? Looks at its title, repository, #number, labels, people and boards. */
export function itemMatches(item, terms) {
    if (terms.length === 0)
        return true;
    return matchesAll([
        item.title, item.repo, itemRef(item), item.platform === 'gitlab' ? 'gitlab' : 'github',
        item.kind === 'pr' && item.reason === 'review' ? 'review' : '',
        ...(item.labels ?? []).map(label => label.name),
        ...(item.assignees ?? []).map(login => `@${login}`),
        ...(item.boards ?? []).flatMap(board => [board.title, board.status ?? '']),
    ].join('\n'), terms);
}

/** Repository groups with only the matching items; empty groups are dropped. */
export function searchGroups(groups, terms) {
    if (terms.length === 0)
        return groups;
    return groups
        .map(group => ({...group, issues: group.issues.filter(item => itemMatches(item, terms))}))
        .filter(group => group.issues.length > 0);
}

/** Boards with only the matching draft items (by title, status or board name). */
export function searchBoards(boards, terms) {
    if (terms.length === 0)
        return boards;
    return boards.map(board => ({
        ...board,
        drafts: board.drafts.filter(draft => matchesAll([draft.title ?? '', draft.status ?? '', board.title].join('\n'), terms)),
    }));
}

/** How many loaded items in list `id` ('issues', 'prs', 'projects') match, across all accounts. */
export function searchCount(id, state, terms) {
    const count = groups => searchGroups(groups ?? [], terms).reduce((sum, group) => sum + group.issues.length, 0);
    const sources = (state.sources ?? []).filter(source => source.status !== 'signed-out');
    switch (id) {
    case 'issues':
        return sources.reduce((sum, source) => sum + count(source.groups), 0);
    case 'prs':
        return sources.reduce((sum, source) => sum + count(source.prGroups), 0);
    case 'tasks':
        return filterTasks(allTasks(sources), [], terms).length;
    case 'projects':
        return sources.reduce((sum, source) =>
            sum + searchBoards(source.boards ?? [], terms).reduce((n, board) => n + board.drafts.length, 0), 0);
    default:
        return 0;
    }
}

/**
 * The id a repository group (or project board, by its node id) is remembered by in the
 * `collapsed-groups` setting, e.g. issues:github:owner/repo or projects:github:PVT_….
 * `section` is the account's sectionKey() (accounts.js): "github" or "gitlab" for the
 * first sign-ins, the account id for accounts added later.
 */
export function groupCollapseId(list, section, name) {
    return `${list}:${section}:${name}`;
}

/** `ids` with `id` added, or without it if it was there (collapsed ↔ expanded). */
export function toggleId(ids, id) {
    return ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id];
}

/** Whether a group shows collapsed. A search expands every group, so its matches show. */
export function isGroupCollapsed(collapsed, id, terms = []) {
    return terms.length === 0 && collapsed.includes(id);
}

// The wallpaper Settings → Desktop Widgets recommends to go with the cards: GNOME's default,
// Adwaita (gnome-backgrounds), with the values from its gnome-background-properties entry.
export const RECOMMENDED_WALLPAPER = {
    'picture-uri': 'file:///usr/share/backgrounds/gnome/adwaita-l.jxl',
    'picture-uri-dark': 'file:///usr/share/backgrounds/gnome/adwaita-d.jxl',
    'picture-options': 'zoom',
    'primary-color': '#3071AE',
    'secondary-color': '#000000',
    'color-shading-type': 'solid',
};
// The org.gnome.desktop.background keys Apply sets, and keeps a copy of to put back.
export const WALLPAPER_KEYS = Object.keys(RECOMMENDED_WALLPAPER);

/** Whether `current` ({key: value} of WALLPAPER_KEYS) shows the recommended wallpaper. */
export function isRecommendedWallpaper(current) {
    return current?.['picture-uri'] === RECOMMENDED_WALLPAPER['picture-uri'] &&
        current?.['picture-uri-dark'] === RECOMMENDED_WALLPAPER['picture-uri-dark'];
}

/** Whether `saved` holds a wallpaper to put back (Apply's copy of the one it replaced). */
function hasSavedWallpaper(saved) {
    return Boolean(saved?.['picture-uri'] || saved?.['picture-uri-dark']);
}

/**
 * What the Wallpaper row offers: 'apply' when another wallpaper is set, 'reset' while the
 * recommended one Apply set is still there, 'in-use' when it's set but not by Apply.
 */
export function wallpaperChoice(current, saved) {
    if (!isRecommendedWallpaper(current))
        return 'apply';
    return hasSavedWallpaper(saved) ? 'reset' : 'in-use';
}

/**
 * Whether Apply's copy of your wallpaper is still worth keeping: only while the recommended
 * one is set. Once the wallpaper changes any other way, Reset is no longer offered.
 */
export function keepSavedWallpaper(current, saved) {
    return hasSavedWallpaper(saved) && isRecommendedWallpaper(current);
}

// Lists → Tasks: everything assigned to you in one list, from every account: issues, pull or
// merge requests, and project board drafts. No sections; an icon tells the kinds apart, and
// filters (kinds and accounts, added like tags) narrow it down.
export const TASK_KINDS = ['issue', 'pr', 'draft'];

/**
 * Every task in `sources` (from sourceFrom), newest first; drafts, which have no date, last.
 * Each is {kind, title, url, repo, ref, updatedAt, account, accountTitle, ...}: `account` is
 * the account's section key; `item` for issues and PRs (for actions and search), `board` and
 * `status` for drafts, whose url is their board's.
 */
export function allTasks(sources) {
    const tasks = [];
    const seen = new Set();
    for (const source of sources ?? []) {
        if (source.status === 'signed-out')
            continue;
        const account = {account: source.key, accountTitle: source.title};
        for (const groups of [source.groups, source.prGroups]) {
            for (const group of groups ?? []) {
                for (const item of group.issues) {
                    // The same item seen by two accounts is one task.
                    const key = item.url ?? itemKey(item);
                    if (seen.has(key))
                        continue;
                    seen.add(key);
                    tasks.push({kind: item.kind, title: item.title, url: item.url ?? null, repo: item.repo,
                        ref: itemRef(item), updatedAt: item.updatedAt ?? null, ...account, item});
                }
            }
        }
        for (const board of source.boards ?? []) {
            for (const draft of board.drafts) {
                tasks.push({kind: 'draft', title: draft.title, url: board.url ?? null, repo: board.title, ref: '',
                    updatedAt: null, status: draft.status, ...account, board, draft});
            }
        }
    }
    const time = task => (task.updatedAt ? Date.parse(task.updatedAt) || 0 : -Infinity);
    // Array.prototype.sort is stable, so drafts keep their board order.
    return tasks.sort((a, b) => time(b) - time(a));
}

/**
 * The tasks that pass `filters` and match `terms`. `filters` is a list of {type, value}:
 * type 'kind' (value 'issue', 'pr' or 'draft') or 'account' (a section key: the assignee,
 * since every task is assigned to the account it came from). Filters of one
 * type add up (Issues + Pull requests shows both); filters of different types narrow
 * (Pull requests + an account shows that account's pull requests). [] shows everything.
 */
export function filterTasks(tasks, filters = [], terms = []) {
    const wanted = type => (filters ?? []).filter(filter => filter.type === type).map(filter => filter.value);
    const kinds = wanted('kind');
    const accounts = wanted('account');
    const labels = wanted('label');
    const assignees = wanted('assignee');
    return tasks.filter(task => (kinds.length === 0 || kinds.includes(task.kind)) &&
        (accounts.length === 0 || accounts.includes(task.account)) &&
        (labels.length === 0 || taskLabels(task).some(name => labels.includes(name))) &&
        (assignees.length === 0 || taskAssignees(task).some(login => assignees.includes(login))) &&
        (task.item
            ? itemMatches(task.item, terms)
            : matchesAll([task.title ?? '', task.status ?? '', task.repo ?? ''].join('\n'), terms)));
}

/**
 * The filters the + menu offers, each {type, value, count}, kinds first, then assignees: your
 * accounts, each one being you on that platform (only with more than one). Counts are of `tasks`; options already in `active` are left out.
 */
export function taskFilterOptions(tasks, sources, active = []) {
    const isActive = (type, value) => (active ?? []).some(filter => filter.type === type && filter.value === value);
    const options = TASK_KINDS.map(kind => ({type: 'kind', value: kind, count: tasks.filter(task => task.kind === kind).length}));
    const accounts = (sources ?? []).filter(source => source.status !== 'signed-out');
    if (accounts.length > 1) {
        for (const source of accounts) {
            options.push({type: 'account', value: source.key, title: source.assignee ?? source.title,
                count: tasks.filter(task => task.account === source.key).length});
        }
    }
    return options.filter(option => !isActive(option.type, option.value));
}

/** The logins assigned to a task: an issue's or PR's assignees, or a draft's. */
function taskAssignees(task) {
    return task.item ? task.item.assignees ?? [] : (task.draft?.assignees ?? []).map(user => user.login);
}

function taskLabels(task) {
    return (task.item?.labels ?? []).map(label => label.name);
}

export const TASK_FILTER_TYPES = ['kind', 'account', 'label', 'assignee'];

/**
 * The Tasks filter menus: {kind, account, label, assignee}, each a list of {type, value,
 * title, count, active} with how many of `tasks` each has; labels and assignees sorted by name.
 * `active` is the chosen filters ({type, value}).
 */
export function taskFilterGroups(tasks, sources, active = []) {
    const isActive = (type, value) => (active ?? []).some(filter => filter.type === type && filter.value === value);
    const option = (type, value, title, count) => ({type, value, title, count, active: isActive(type, value)});
    const tally = names => {
        const counts = new Map();
        for (const list of names) {
            for (const name of new Set(list))
                counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
    };
    return {
        kind: TASK_KINDS.map(kind => option('kind', kind, null, tasks.filter(task => task.kind === kind).length)),
        account: (sources ?? []).filter(source => source.status !== 'signed-out')
            .map(source => option('account', source.key, source.assignee ?? source.title,
                tasks.filter(task => task.account === source.key).length)),
        label: tally(tasks.map(taskLabels)).map(([name, count]) => option('label', name, name, count)),
        assignee: tally(tasks.map(taskAssignees)).map(([login, count]) => option('assignee', login, login, count)),
    };
}

/** Adds the filter, or takes it off if it's there (a check in a filter menu). */
export function toggleTaskFilter(filters, filter) {
    const has = filters.some(other => other.type === filter.type && other.value === filter.value);
    return has
        ? filters.filter(other => other.type !== filter.type || other.value !== filter.value)
        : [...filters, filter];
}

/** How many tasks of each kind: {all, issue, pr, draft}. */
export function taskCounts(tasks) {
    const counts = {all: tasks.length, issue: 0, pr: 0, draft: 0};
    for (const task of tasks)
        counts[task.kind]++;
    return counts;
}
