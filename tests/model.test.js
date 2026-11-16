import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
    buildSearchPath,
    buildSearchQuery,
    classifyHttpError,
    countLabel,
    groupIssues,
    isSafeGitHubUrl,
    isValidRepo,
    nextRefreshDelaySeconds,
    parseRepoList,
    parseSearchResponse,
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
    const {issues} = parseSearchResponse({items: [{number: 1, title: 'x', html_url: 'file:///etc/passwd',
        repository_url: 'https://api.github.com/repos/a/b', updated_at: '2026-11-01T00:00:00Z'}]});
    assert.equal(issues[0].url, null);
});

test('repoFromApiUrl extracts owner/name', () => {
    assert.equal(repoFromApiUrl('https://api.github.com/repos/omer-gh/sourceglance'), 'omer-gh/sourceglance');
    assert.equal(repoFromApiUrl(undefined), 'unknown');
});

test('parseSearchResponse maps items and skips pull requests', () => {
    const result = parseSearchResponse({
        total_count: 3,
        items: [
            {number: 1, title: 'One', html_url: 'https://github.com/a/b/issues/1',
                repository_url: 'https://api.github.com/repos/a/b', updated_at: '2026-11-01T00:00:00Z'},
            {number: 2, title: 'PR', html_url: 'u', repository_url: 'x', updated_at: 'y', pull_request: {}},
        ],
    });
    assert.equal(result.total, 3);
    assert.deepEqual(result.issues, [{
        number: 1, title: 'One', url: 'https://github.com/a/b/issues/1', repo: 'a/b',
        updatedAt: '2026-11-01T00:00:00Z',
    }]);
    assert.deepEqual(parseSearchResponse(null), {total: 0, issues: []});
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
