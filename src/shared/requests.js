// Write requests for an item on either platform, so the menus and the window stay
// platform-blind, and which links may be opened. Pure (no GNOME imports).
import {GITHUB_COM, isSafeAccountUrl, isValidAccountLogin} from './accounts.js';
import {
    gitlabAssigneesRequest,
    gitlabBodyRequest,
    gitlabClosedPageUrl,
    gitlabCloseRequest,
    gitlabCommentRequest,
    gitlabDetailsRequests,
    gitlabFieldRequests,
    gitlabFieldsRequest,
    gitlabLabelsRequest,
    gitlabReopenRequest,
    isSafeGitLabUrl,
    parseGitLabDetails,
    parseGitLabFields,
} from './gitlabModel.js';
import {
    assigneeChangeRequests,
    bodyRequest,
    boardFieldsRequest,
    closeRequest,
    commentRequest,
    detailsRequests,
    draftAssigneesRequest,
    draftBodyRequest,
    draftDetailsRequest,
    githubFieldRequests,
    isSafeGitHubUrl,
    issueFieldsRequest,
    labelChangeRequests,
    parseBoardFields,
    parseDetails,
    parseDraftDetails,
    parseIssueFields,
    reopenRequest,
    searchPageUrl,
} from './model.js';

const isGitLab = item => item?.platform === 'gitlab';

// Instances of the signed-in accounts besides github.com and gitlab.com, set by whoever
// reads the account list (the extension, the window). Links to them may be opened too.
let accountBases = [];

/** Sets the self-hosted instances whose links may be opened (`bases` of the accounts). */
export function allowLinkBases(bases) {
    accountBases = [...new Set(bases)].filter(base => typeof base === 'string' && base !== GITHUB_COM);
}

/** Links from github.com, gitlab.com or an account's own instance that may be opened. */
export function isSafeLink(url) {
    return isSafeGitHubUrl(url) || isSafeGitLabUrl(url) || accountBases.some(base => isSafeAccountUrl(url, base));
}

/** Close reasons to offer: GitHub issues can be "not planned"; GitLab has none. */
export function closeReasons(item) {
    return !isGitLab(item) && item.kind === 'issue' ? ['not_planned', 'completed'] : ['close'];
}

export function closeRequests(item, reason) {
    return [isGitLab(item) ? gitlabCloseRequest(item) : closeRequest(item, reason === 'close' ? 'completed' : reason)];
}

export function reopenRequests(item) {
    return [isGitLab(item) ? gitlabReopenRequest(item) : reopenRequest(item)];
}

export function commentRequests(item, text) {
    const request = isGitLab(item) ? gitlabCommentRequest(item, text) : commentRequest(item, text);
    return request ? [request] : [];
}

export function labelRequests(item, wanted) {
    return isGitLab(item) ? [gitlabLabelsRequest(item, wanted)].filter(Boolean) : labelChangeRequests(item, wanted);
}

/** `members` are GitLab's [{id, username}] (assignees are set by id there). */
export function assigneeRequests(item, wanted, members = []) {
    if (item.kind === 'draft')
        return [draftAssigneesRequest(item, wanted)].filter(Boolean);
    return isGitLab(item)
        ? [gitlabAssigneesRequest(item, wanted, members)].filter(Boolean)
        : assigneeChangeRequests(item, wanted);
}

/**
 * The account's page of closed items still assigned to you (`kind` is 'issue' or 'pr'), for
 * the list footers. The repository filter applies to github.com accounts only.
 */
export function closedPageUrl(account, kind, repos = []) {
    if (account.platform === 'gitlab')
        return gitlabClosedPageUrl(kind, account.login, account.base);
    return searchPageUrl(kind === 'pr' ? 'pr-closed' : 'issue-closed', account.base === GITHUB_COM ? repos : [], account.base);
}

/** The account's profile page, or null before its login is known. */
export function profileUrl(account) {
    return isValidAccountLogin(account.login) ? `${account.base}/${encodeURIComponent(account.login)}` : null;
}

/**
 * The preview's GET requests: [item] for a draft, [item, comments] otherwise. `parse` turns
 * their responses (in that order) into the preview (see parseDetails() in model.js).
 */
export function previewRequests(item) {
    if (item.kind === 'draft')
        return {requests: [draftDetailsRequest(item)], parse: ([json]) => parseDraftDetails(json)};
    const {item: one, comments} = isGitLab(item) ? gitlabDetailsRequests(item) : detailsRequests(item);
    return {requests: [one, comments], parse: ([a, b]) => (isGitLab(item) ? parseGitLabDetails(a, b) : parseDetails(a, b))};
}

/** Replaces the description; [] if it's too long. */
export function bodyRequests(item, text) {
    const request = item.kind === 'draft' ? draftBodyRequest(item, text)
        : isGitLab(item) ? gitlabBodyRequest(item, text) : bodyRequest(item, text);
    return request ? [request] : [];
}

/**
 * The Fields dialog's GET requests and how to read them: GitHub issue fields (issues only)
 * and every board's fields (issues, PRs, drafts), or GitLab's custom fields (issues only).
 * `parse` takes the responses in order, null for one that failed, and returns the sections.
 */
export function fieldsRequests(item) {
    if (isGitLab(item)) {
        const request = gitlabFieldsRequest(item);
        return {requests: request ? [request] : [], parse: ([json]) => (json ? parseGitLabFields(json) : [])};
    }
    const issue = issueFieldsRequest(item);
    const boards = boardFieldsRequest(item);
    return {
        requests: [issue, boards].filter(Boolean),
        parse: responses => {
            const [issueJson, boardsJson] = issue ? responses : [null, responses[0]];
            return [issue && issueJson ? parseIssueFields(issueJson) : null, ...(boards && boardsJson ? parseBoardFields(boardsJson) : [])]
                .filter(Boolean);
        },
    };
}

/** Requests that apply the Fields dialog's edits ({section, field, value|selected}). */
export function fieldRequests(item, edits) {
    return isGitLab(item) ? gitlabFieldRequests(edits) : githubFieldRequests(edits);
}
