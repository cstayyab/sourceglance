import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
    DEVICE_VERIFICATION_URL,
    MAX_COMMENT_LENGTH,
    PROJECT_ITEMS_QUERY,
    classifyGraphqlErrors,
    moveStatusRequest,
    parseProjectItems,
    projectItemsRequest,
    addLabelsRequest,
    appInstallUrl,
    assigneesRequest,
    buildSearchPath,
    buildSearchQuery,
    classifyDeviceTokenResponse,
    classifyHttpError,
    closeRequest,
    commentRequest,
    countLabel,
    diffSelection,
    filterByLabel,
    formEncode,
    groupIssues,
    isSafeGitHubUrl,
    isValidLogin,
    isValidRepo,
    labelOptions,
    mergeItems,
    nextRefreshDelaySeconds,
    parseDeviceCodeResponse,
    parseLabels,
    parseLogins,
    parseRepoList,
    parseSearchResponse,
    removeLabelRequest,
    reopenRequest,
    relativeTime,
    repoFromApiUrl,
    truncate,
} from '../src/lib/model.js';

test('isValidRepo accepts owner/name and rejects junk', () => {
    assert.ok(isValidRepo('omer-gh/sourceglance'));
    assert.ok(isValidRepo('GNOME/gnome-shell.git-mirror_1'));
    assert.ok(!isValidRepo('sourceglance'));
    assert.ok(!isValidRepo('a/b/c'));
    assert.ok(!isValidRepo('-bad/name'));
    assert.ok(!isValidRepo('owner/na me'));
    assert.ok(!isValidRepo('owner/name repo:evil/x'));
});

test('parseRepoList splits, dedupes and reports invalid entries', () => {
    assert.deepEqual(parseRepoList(' a/b, c/d  a/b ,bad,, '), {repos: ['a/b', 'c/d'], invalid: ['bad']});
    assert.deepEqual(parseRepoList(''), {repos: [], invalid: []});
});

test('buildSearchQuery adds repo qualifiers and drops invalid repos', () => {
    assert.equal(buildSearchQuery(), 'is:open is:issue assignee:@me archived:false');
    assert.equal(
        buildSearchQuery(['a/b', 'not valid', 'c/d']),
        'is:open is:issue assignee:@me archived:false repo:a/b repo:c/d');
});

test('buildSearchPath encodes the query and sorts by update', () => {
    const path = buildSearchPath(['a/b']);
    assert.ok(path.startsWith('/search/issues?q=is%3Aopen%20is%3Aissue%20assignee%3A%40me'));
    assert.ok(path.includes('repo%3Aa%2Fb'));
    assert.ok(path.endsWith('&sort=updated&order=desc&per_page=25'));
});

test('isSafeGitHubUrl only allows https://github.com links', () => {
    assert.ok(isSafeGitHubUrl('https://github.com/omer-gh/sourceglance/issues/12'));
    assert.ok(isSafeGitHubUrl('https://github.com/issues/assigned'));
    assert.ok(!isSafeGitHubUrl('http://github.com/a/b/issues/1'));
    assert.ok(!isSafeGitHubUrl('https://github.com.evil.example/a'));
    assert.ok(!isSafeGitHubUrl('https://evil.example/https://github.com/'));
    assert.ok(!isSafeGitHubUrl('https://user@github.com/a'));
    assert.ok(!isSafeGitHubUrl('javascript:alert(1)'));
    assert.ok(!isSafeGitHubUrl('file:///etc/passwd'));
    assert.ok(!isSafeGitHubUrl('https://github.com/a b'));
    assert.ok(!isSafeGitHubUrl(null));
});

test('parseSearchResponse drops unsafe issue links', () => {
    const {items} = parseSearchResponse({items: [{number: 1, title: 'x', html_url: 'file:///etc/passwd',
        repository_url: 'https://api.github.com/repos/a/b', updated_at: '2026-11-01T00:00:00Z'}]});
    assert.equal(items[0].url, null);
});

test('buildSearchQuery lists PRs assigned to you or awaiting your review', () => {
    assert.equal(buildSearchQuery([], 'pr-assigned'), 'is:open is:pr assignee:@me archived:false');
    assert.equal(buildSearchQuery(['a/b'], 'pr-review'),
        'is:open is:pr review-requested:@me archived:false repo:a/b');
    assert.ok(buildSearchPath([], 'pr-review').includes('review-requested%3A%40me'));
});

test('repoFromApiUrl extracts owner/name', () => {
    assert.equal(repoFromApiUrl('https://api.github.com/repos/omer-gh/sourceglance'), 'omer-gh/sourceglance');
    assert.equal(repoFromApiUrl(undefined), 'unknown');
});

test('parseSearchResponse maps items and skips pull requests', () => {
    const result = parseSearchResponse({
        total_count: 3,
        items: [
            {number: 1, title: 'One', html_url: 'https://github.com/a/b/issues/1', node_id: 'I_1',
                state: 'open', repository_url: 'https://api.github.com/repos/a/b',
                updated_at: '2026-11-01T00:00:00Z',
                labels: [{name: 'bug', color: 'D73A4A'}, {name: ''}, {color: 'fff'}],
                assignees: [{login: 'omer-gh'}, {login: 'bad login'}, null]},
            {number: 2, title: 'PR', html_url: 'u', repository_url: 'x', updated_at: 'y', pull_request: {}},
        ],
    });
    assert.equal(result.total, 3);
    assert.deepEqual(result.items, [{
        kind: 'issue', reason: 'assigned', number: 1, title: 'One',
        url: 'https://github.com/a/b/issues/1', repo: 'a/b', nodeId: 'I_1', state: 'open',
        labels: [{name: 'bug', color: 'd73a4a'}], assignees: ['omer-gh'],
        updatedAt: '2026-11-01T00:00:00Z',
    }]);
    assert.deepEqual(parseSearchResponse(null), {total: 0, items: []});
});

test('parseSearchResponse keeps only PRs for PR searches, with the reason', () => {
    const json = {items: [
        {number: 1, title: 'Issue', repository_url: 'https://api.github.com/repos/a/b'},
        {number: 7, title: 'PR', repository_url: 'https://api.github.com/repos/a/b', pull_request: {}},
    ]};
    const review = parseSearchResponse(json, 'pr-review').items;
    assert.deepEqual(review.map(i => [i.kind, i.number, i.reason]), [['pr', 7, 'review']]);
    assert.equal(parseSearchResponse(json, 'pr-assigned').items[0].reason, 'assigned');
    assert.equal([...parseSearchResponse({items: [{number: 3, title: 'x'.repeat(500)}]}).items[0].title].length, 300);
});

test('mergeItems dedupes by repo and number, first copy wins', () => {
    const a = {repo: 'a/b', number: 7, reason: 'assigned'};
    const b = {repo: 'a/b', number: 7, reason: 'review'};
    const c = {repo: 'a/b', number: 8, reason: 'review'};
    assert.deepEqual(mergeItems([a], [b, c]), [a, c]);
});

test('close and reopen requests use the issues or pulls endpoint', () => {
    const issue = {kind: 'issue', repo: 'a/b', number: 3};
    const pr = {kind: 'pr', repo: 'a/b', number: 4};
    assert.deepEqual(closeRequest(issue, 'not_planned'),
        {method: 'PATCH', path: '/repos/a/b/issues/3', body: {state: 'closed', state_reason: 'not_planned'}});
    assert.deepEqual(closeRequest(pr), {method: 'PATCH', path: '/repos/a/b/pulls/4', body: {state: 'closed'}});
    assert.deepEqual(reopenRequest(issue),
        {method: 'PATCH', path: '/repos/a/b/issues/3', body: {state: 'open', state_reason: 'reopened'}});
    assert.deepEqual(reopenRequest(pr), {method: 'PATCH', path: '/repos/a/b/pulls/4', body: {state: 'open'}});
    assert.throws(() => closeRequest(issue, 'spam'));
});

test('write requests refuse items that would inject into the URL', () => {
    for (const bad of [
        {repo: '../../user', number: 1},
        {repo: 'unknown', number: 1},
        {repo: 'a/b', number: '1/../../x'},
        {repo: 'a/b', number: 0},
        null,
    ])
        assert.throws(() => closeRequest(bad), TypeError);
});

test('commentRequest trims and rejects empty or oversized comments', () => {
    const item = {kind: 'issue', repo: 'a/b', number: 3};
    assert.deepEqual(commentRequest(item, '  hi  '),
        {method: 'POST', path: '/repos/a/b/issues/3/comments', body: {body: 'hi'}});
    assert.equal(commentRequest(item, '   '), null);
    assert.equal(commentRequest(item, 'x'.repeat(MAX_COMMENT_LENGTH + 1)), null);
});

test('assignee and label requests validate names and encode label paths', () => {
    const item = {kind: 'pr', repo: 'a/b', number: 3};
    assert.deepEqual(assigneesRequest(item, ['omer-gh', 'omer-gh', 'bad login'], true),
        {method: 'POST', path: '/repos/a/b/issues/3/assignees', body: {assignees: ['omer-gh']}});
    assert.equal(assigneesRequest(item, ['omer-gh'], false).method, 'DELETE');
    assert.equal(assigneesRequest(item, ['bad login'], false), null);
    assert.deepEqual(addLabelsRequest(item, ['bug', 'bug', '']),
        {method: 'POST', path: '/repos/a/b/issues/3/labels', body: {labels: ['bug']}});
    assert.equal(removeLabelRequest(item, 'needs/triage ?').path,
        '/repos/a/b/issues/3/labels/needs%2Ftriage%20%3F');
    assert.throws(() => removeLabelRequest(item, ''), TypeError);
});

test('projectItemsRequest dedupes and validates node IDs', () => {
    const request = projectItemsRequest(['I_1', 'I_1', 'PR_2', 'bad id!', null]);
    assert.equal(request.path, '/graphql');
    assert.equal(request.graphql, true);
    assert.deepEqual(request.body.variables, {ids: ['I_1', 'PR_2']});
    assert.equal(request.body.query, PROJECT_ITEMS_QUERY);
    assert.equal(projectItemsRequest([]), null);
});

test('parseProjectItems keeps open boards with a Status field and tolerates gaps', () => {
    const board = (id, extra = {}) => ({
        id: `PVTI_${id}`,
        project: {id: `PVT_${id}`, title: `Board ${id}`, closed: false,
            field: {id: `PVTSSF_${id}`, options: [{id: 'a1', name: 'Todo'}, {id: 'b2', name: 'Done'}]}},
        fieldValueByName: {optionId: 'b2', name: 'Done'},
        ...extra,
    });
    const boards = parseProjectItems({
        data: {nodes: [
            {id: 'I_1', projectItems: {nodes: [
                board('x'),
                board('closed', {project: {...board('c').project, closed: true}}),
                board('nostatus', {project: {id: 'PVT_n', title: 'n', closed: false, field: null}}),
                board('unset', {fieldValueByName: null}),
                null,
            ]}},
            null,
            {id: 'PR_2', projectItems: null},
        ]},
        errors: [{type: 'FORBIDDEN'}],
    });
    assert.deepEqual(boards.get('I_1'), [
        {itemId: 'PVTI_x', projectId: 'PVT_x', title: 'Board x', fieldId: 'PVTSSF_x',
            options: [{id: 'a1', name: 'Todo'}, {id: 'b2', name: 'Done'}], optionId: 'b2', status: 'Done'},
        {itemId: 'PVTI_unset', projectId: 'PVT_unset', title: 'Board unset', fieldId: 'PVTSSF_unset',
            options: [{id: 'a1', name: 'Todo'}, {id: 'b2', name: 'Done'}], optionId: null, status: null},
    ]);
    assert.deepEqual(boards.get('PR_2'), []);
    assert.equal(parseProjectItems(null).size, 0);
});

test('moveStatusRequest only accepts the board\'s own options', () => {
    const board = {itemId: 'PVTI_x', projectId: 'PVT_x', fieldId: 'F_x', options: [{id: 'a1', name: 'Todo'}]};
    assert.deepEqual(moveStatusRequest(board, 'a1').body.variables,
        {project: 'PVT_x', item: 'PVTI_x', field: 'F_x', option: 'a1'});
    assert.throws(() => moveStatusRequest(board, 'zz'), TypeError);
    assert.throws(() => moveStatusRequest({...board, itemId: '"; drop'}, 'a1'), TypeError);
});

test('classifyGraphqlErrors maps GraphQL error types', () => {
    assert.equal(classifyGraphqlErrors([{type: 'FORBIDDEN'}]), 'forbidden');
    assert.equal(classifyGraphqlErrors([{type: 'INSUFFICIENT_SCOPES'}]), 'forbidden');
    assert.equal(classifyGraphqlErrors([{type: 'NOT_FOUND'}]), 'not-found');
    assert.equal(classifyGraphqlErrors([{message: 'x'}]), 'query');
    assert.equal(classifyGraphqlErrors(null), 'query');
});

test('labelOptions counts each label once per item, sorted by name', () => {
    const item = (...names) => ({labels: names.map(name => ({name, color: null}))});
    const groups = [
        {repo: 'a/b', issues: [item('ui', 'bug'), item('bug', 'bug')]},
        {repo: 'c/d', issues: [item(), item('docs')]},
    ];
    assert.deepEqual(labelOptions(groups),
        [{name: 'bug', count: 2}, {name: 'docs', count: 1}, {name: 'ui', count: 1}]);
    assert.deepEqual(labelOptions([]), []);
});

test('filterByLabel keeps matching items and drops emptied repositories', () => {
    const item = (number, ...names) => ({number, labels: names.map(name => ({name, color: null}))});
    const groups = [
        {repo: 'a/b', issues: [item(1, 'bug'), item(2)]},
        {repo: 'c/d', issues: [item(3, 'docs')]},
    ];
    assert.deepEqual(filterByLabel(groups, 'bug'), [{repo: 'a/b', issues: [item(1, 'bug')]}]);
    assert.equal(filterByLabel(groups, null), groups);
    assert.deepEqual(filterByLabel(groups, 'none'), []);
});

test('diffSelection lists additions and removals', () => {
    assert.deepEqual(diffSelection(['a', 'b'], ['b', 'c']), {add: ['c'], remove: ['a']});
    assert.deepEqual(diffSelection([], []), {add: [], remove: []});
});

test('parseLabels and parseLogins drop malformed entries', () => {
    assert.deepEqual(parseLabels([{name: 'x', color: 'zzzzzz'}, 'bad', {name: 'y', color: 'ABCDEF'}]),
        [{name: 'x', color: null}, {name: 'y', color: 'abcdef'}]);
    assert.deepEqual(parseLabels(null), []);
    assert.deepEqual(parseLogins([{login: 'a-b'}, {login: '-bad'}, {}]), ['a-b']);
    assert.ok(isValidLogin('omer-gh'));
    assert.ok(!isValidLogin('a/b'));
});

test('groupIssues orders issues and repos by most recent update', () => {
    const issue = (repo, number, day) => ({repo, number, title: '', url: '', updatedAt: `2026-11-${day}T00:00:00Z`});
    const groups = groupIssues([issue('a/a', 1, '01'), issue('b/b', 2, '05'), issue('a/a', 3, '03')]);
    assert.deepEqual(groups.map(g => g.repo), ['b/b', 'a/a']);
    assert.deepEqual(groups[1].issues.map(i => i.number), [3, 1]);
    assert.deepEqual(groupIssues([]), []);
});

test('classifyHttpError maps statuses to kinds', () => {
    assert.equal(classifyHttpError(401).kind, 'auth');
    assert.equal(classifyHttpError(403).kind, 'forbidden');
    assert.equal(classifyHttpError(404).kind, 'not-found');
    assert.equal(classifyHttpError(410).kind, 'gone');
    assert.equal(classifyHttpError(422).kind, 'query');
    assert.equal(classifyHttpError(502).kind, 'server');
    assert.equal(classifyHttpError(0).kind, 'network');
    assert.equal(classifyHttpError(418).kind, 'unknown');
});

test('classifyHttpError detects rate limits and computes retry time', () => {
    const now = 1_000_000;
    assert.deepEqual(
        classifyHttpError(403, {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000'}, now),
        {kind: 'rate-limit', status: 403, retryAt: 2_000_000});
    assert.deepEqual(
        classifyHttpError(429, {'retry-after': '30'}, now),
        {kind: 'rate-limit', status: 429, retryAt: now + 30_000});
    assert.equal(classifyHttpError(403, {'x-ratelimit-remaining': '12'}).kind, 'forbidden');
});

test('nextRefreshDelaySeconds uses the interval or the rate-limit reset', () => {
    assert.equal(nextRefreshDelaySeconds(10), 600);
    assert.equal(nextRefreshDelaySeconds(0), 60);
    const now = 0;
    assert.equal(nextRefreshDelaySeconds(10, {kind: 'rate-limit', retryAt: 300_000}, now), 300);
    assert.equal(nextRefreshDelaySeconds(10, {kind: 'rate-limit', retryAt: 5_000}, now), 60);
    assert.equal(nextRefreshDelaySeconds(10, {kind: 'network', retryAt: null}, now), 600);
});

test('relativeTime picks the right unit', () => {
    const now = Date.parse('2026-11-16T12:00:00Z');
    const ago = s => new Date(now - s * 1000);
    assert.deepEqual(relativeTime(ago(30), now), {unit: 'now', value: 0});
    assert.deepEqual(relativeTime(ago(125), now), {unit: 'minute', value: 2});
    assert.deepEqual(relativeTime(ago(3 * 3600), now), {unit: 'hour', value: 3});
    assert.deepEqual(relativeTime(ago(49 * 3600), now), {unit: 'day', value: 2});
    assert.deepEqual(relativeTime(ago(-10), now), {unit: 'now', value: 0});
});

test('truncate shortens long titles with an ellipsis', () => {
    assert.equal(truncate('short'), 'short');
    assert.equal(truncate('abcdefghij', 5), 'abcd…');
    assert.equal(truncate('abc def', 5), 'abc…');
    assert.equal([...truncate('é'.repeat(60))].length, 48);
});

test('countLabel hides zero and marks truncation', () => {
    assert.equal(countLabel(0, 0), '');
    assert.equal(countLabel(7, 7), '7');
    assert.equal(countLabel(31, 25), '25+');
});

test('appInstallUrl builds the install page only for valid slugs', () => {
    assert.equal(appInstallUrl('sourceglance'), 'https://github.com/apps/sourceglance/installations/new');
    assert.equal(appInstallUrl('git-glance-2'), 'https://github.com/apps/git-glance-2/installations/new');
    assert.equal(appInstallUrl(''), null);
    assert.equal(appInstallUrl(null), null);
    assert.equal(appInstallUrl('../evil'), null);
    assert.equal(appInstallUrl('Bad Slug'), null);
});

test('formEncode builds a form body', () => {
    assert.equal(formEncode({client_id: 'Iv1.abc', scope: 'repo'}), 'client_id=Iv1.abc&scope=repo');
    assert.equal(formEncode({grant_type: 'urn:a b&c'}), 'grant_type=urn%3Aa%20b%26c');
});

test('parseDeviceCodeResponse validates the code and pins the link to github.com', () => {
    const ok = {
        device_code: 'dc123',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://github.com/login/device',
        expires_in: 899,
        interval: 5,
    };
    assert.deepEqual(parseDeviceCodeResponse(ok), {
        deviceCode: 'dc123',
        userCode: 'WDJB-MJHT',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 899,
        interval: 5,
    });
    const evil = parseDeviceCodeResponse({...ok, verification_uri: 'https://evil.example/login'});
    assert.equal(evil.verificationUri, DEVICE_VERIFICATION_URL);
    const defaults = parseDeviceCodeResponse({...ok, expires_in: 'x', interval: -1});
    assert.equal(defaults.expiresIn, 900);
    assert.equal(defaults.interval, 5);
    assert.equal(parseDeviceCodeResponse({error: 'device_flow_disabled'}), null);
    assert.equal(parseDeviceCodeResponse({...ok, user_code: '<b>hi</b>'}), null);
    assert.equal(parseDeviceCodeResponse(null), null);
});

test('classifyDeviceTokenResponse maps every poll outcome', () => {
    assert.deepEqual(classifyDeviceTokenResponse({access_token: 'gho_x', scope: 'repo'}, 5),
        {state: 'done', token: 'gho_x'});
    assert.deepEqual(classifyDeviceTokenResponse({error: 'authorization_pending'}, 5),
        {state: 'pending', interval: 5});
    assert.deepEqual(classifyDeviceTokenResponse({error: 'slow_down', interval: 10}, 5),
        {state: 'slow-down', interval: 10});
    assert.deepEqual(classifyDeviceTokenResponse({error: 'slow_down'}, 5),
        {state: 'slow-down', interval: 10});
    assert.deepEqual(classifyDeviceTokenResponse({error: 'expired_token'}, 5), {state: 'expired'});
    assert.deepEqual(classifyDeviceTokenResponse({error: 'access_denied'}, 5), {state: 'denied'});
    assert.deepEqual(classifyDeviceTokenResponse({error: 'device_flow_disabled'}, 5),
        {state: 'error', error: 'device_flow_disabled'});
    assert.deepEqual(classifyDeviceTokenResponse(null, 5), {state: 'error', error: 'unknown'});
});
