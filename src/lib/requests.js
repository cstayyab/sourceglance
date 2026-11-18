// Write requests for an item on either platform, so the menus and the window stay
// platform-blind, and which links may be opened. Pure (no GNOME imports).
import {GITHUB_COM, isSafeAccountUrl, isValidAccountLogin} from './accounts.js';
import {
    gitlabAssigneesRequest,
    gitlabClosedPageUrl,
    gitlabCloseRequest,
    gitlabCommentRequest,
    gitlabLabelsRequest,
    gitlabReopenRequest,
    isSafeGitLabUrl,
} from './gitlabModel.js';
import {
    assigneeChangeRequests,
    closeRequest,
    commentRequest,
    isSafeGitHubUrl,
    labelChangeRequests,
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
