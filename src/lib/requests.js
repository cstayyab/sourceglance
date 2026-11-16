// Write requests for an item on either platform, so the menus and the window stay
// platform-blind. Pure (no GNOME imports).
import {
    gitlabAssigneesRequest,
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
} from './model.js';

const isGitLab = item => item?.platform === 'gitlab';

/** Links from either platform's data that may be opened. */
export function isSafeLink(url) {
    return isSafeGitHubUrl(url) || isSafeGitLabUrl(url);
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
