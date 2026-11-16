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

/** github.com page listing what a search finds, for "View on GitHub" links and list footers. */
export function searchPageUrl(search, repos = []) {
    const page = search.startsWith('pr') ? 'pulls' : 'issues';
    return `https://github.com/${page}?q=${encodeURIComponent(buildSearchQuery(repos, search))}`;
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
        'Name=sourceglance',
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
            content { ... on DraftIssue { title } }
            fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId name } }
        }
    }`;

export const VIEWER_BOARDS_QUERY = `query {
    viewer {
        projectsV2(first: 20) { nodes { ${BOARD_FIELDS} } }
        organizations(first: 20) { nodes { projectsV2(first: 20) { nodes { ${BOARD_FIELDS} } } } }
    }
}`;

export function viewerBoardsRequest() {
    return {method: 'POST', path: '/graphql', graphql: true, body: {query: VIEWER_BOARDS_QUERY, variables: {}}};
}

function parseBoard(project) {
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
            title: cappedString(node.content?.title, 300),
            optionId: current?.id ?? null,
            status: current?.name ?? null,
        });
    }
    return {
        projectId: project.id,
        title,
        url: isSafeGitHubUrl(project.url) ? project.url : null,
        fieldId: isNodeId(field?.id) ? field.id : null,
        options,
        drafts,
        // Items past the first page (of any kind) may hide more drafts.
        truncated: (project.items?.totalCount ?? 0) > MAX_BOARD_ITEMS,
    };
}

/**
 * Boards from VIEWER_BOARDS_QUERY: open boards with their non-archived draft items. Tolerant of
 * partial data (`errors` for boards the sign-in can't read); duplicates are dropped.
 */
export function parseViewerBoards(json) {
    const viewer = json?.data?.viewer;
    const projects = [
        ...(viewer?.projectsV2?.nodes ?? []),
        ...(viewer?.organizations?.nodes ?? []).flatMap(org => org?.projectsV2?.nodes ?? []),
    ];
    const seen = new Set();
    const boards = [];
    for (const project of projects) {
        const board = parseBoard(project);
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
        item: {kind: 'draft', repo: 'project', number: draft.itemId, title: draft.title, labels: [], assignees: []},
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

/**
 * Count for a list's top-bar button, tab or sidebar row: '0' included once loaded; ''
 * hides it (signed out, or not loaded yet). `state` has status, updatedAt, issueTotal/Shown,
 * prTotal/Shown, boards and boardsError.
 */
export function listBadge(id, state) {
    const signedIn = state.status === 'ready' || state.status === 'error';
    if (!signedIn || state.updatedAt === null)
        return '';
    switch (id) {
    case 'issues':
        return countLabel(state.issueTotal, state.issueShown) || '0';
    case 'prs':
        return countLabel(state.prTotal, state.prShown) || '0';
    case 'projects':
        if (state.boards === null)
            return state.boardsError ? '' : '…';
        return String(state.boards.reduce((sum, board) => sum + board.drafts.length, 0));
    default:
        return '';
    }
}

/** Text for the panel badge: '' (hidden), '7', or '25+' when results were cut off. */
export function countLabel(total, shown) {
    if (!total)
        return '';
    return total > shown ? `${shown}+` : String(total);
}
