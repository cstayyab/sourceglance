// Loads the GitLab lists in one go, for the top bar (extension.js) and the window
// (window/data.js). The result uses the same field names as the GitHub state, under
// state.gitlab, so views and counts can treat both alike.
import {GITLAB_CLIENT_ID} from './config.js';
import {isCancelled} from './github.js';
import {mergeItems} from './model.js';

/**
 * @returns {Promise<object>} {status: 'signed-out'} or {status: 'ready', login, updatedAt,
 *   issues, prs, issueTotal, prTotal, closedCounts}. Throws on API errors.
 */
export async function loadGitLab(client, cancellable = null) {
    const token = await client.accessToken(GITLAB_CLIENT_ID, cancellable);
    if (!token)
        return {status: 'signed-out'};
    const viewer = await client.getViewer(token, cancellable);
    const [issues, assigned, review] = await Promise.all([
        client.list(token, 'issue', null, cancellable),
        client.list(token, 'mr-assigned', null, cancellable),
        client.list(token, 'mr-review', viewer.username, cancellable),
    ]);
    let closedCounts = {issues: null, prs: null};
    try {
        closedCounts = await client.closedCounts(token, cancellable);
    } catch (e) {
        if (isCancelled(e))
            throw e;
    }
    const prs = mergeItems(assigned.items, review.items);
    return {
        status: 'ready',
        login: viewer.username,
        updatedAt: new Date(),
        issues: issues.items,
        issueTotal: issues.total,
        prs,
        // Results past the first page of either MR list aren't in `prs`.
        prTotal: prs.length + Math.max(0, assigned.total - assigned.items.length) +
            Math.max(0, review.total - review.items.length),
        closedCounts,
        error: null,
    };
}
