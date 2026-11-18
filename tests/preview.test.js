import {test} from 'node:test';
import assert from 'node:assert/strict';

import {bodyRequest, draftBodyRequest, draftDetailsRequest, parseDetails, parseDraftDetails, parseReactions} from '../src/lib/model.js';
import {gitlabBodyRequest, parseGitLabDetails} from '../src/lib/gitlabModel.js';
import {bodyRequests, previewRequests} from '../src/lib/requests.js';

const issue = {kind: 'issue', repo: 'octo/app', number: 42, labels: [], assignees: []};
const glIssue = {platform: 'gitlab', kind: 'issue', repo: 'g/p', projectId: 9, number: 3, labels: [], assignees: []};
const draft = {kind: 'draft', repo: 'project', number: 'PVTI_1', draftId: 'DI_1', labels: [], assignees: []};

test('parseReactions keeps the used ones, in GitHub\'s order', () => {
    assert.deepEqual(parseReactions({'+1': 3, 'heart': 1, 'eyes': 0, 'total_count': 4, 'laugh': 'x'}),
        [{emoji: '👍', count: 3}, {emoji: '❤️', count: 1}]);
    assert.deepEqual(parseReactions(null), []);
});

test('previewRequests asks for the item and its comments, and parses them as plain data', () => {
    const {requests, parse} = previewRequests(issue);
    assert.deepEqual(requests.map(r => `${r.method} ${r.path}`),
        ['GET /repos/octo/app/issues/42', 'GET /repos/octo/app/issues/42/comments?per_page=100']);
    const details = parse([
        {body: '<b>hi</b>', user: {login: 'amy'}, created_at: '2026-11-01T00:00:00Z', comments: 3, reactions: {'+1': 2}},
        [{body: 'one', user: {login: 'me'}, created_at: 'x', reactions: {rocket: 1}}, {body: 5}, {body: 'two', user: {login: 'bad login'}}],
    ]);
    assert.equal(details.body, '<b>hi</b>');
    assert.equal(details.author, 'amy');
    assert.deepEqual(details.reactions, [{emoji: '👍', count: 2}]);
    assert.deepEqual(details.comments.map(c => [c.author, c.body, c.reactions.length]), [['me', 'one', 1], [null, 'two', 0]]);
    assert.equal(details.more, 1);
    assert.deepEqual(parseDetails(null, null), {body: '', author: null, createdAt: null, reactions: [], comments: [], more: 0});
});

test('GitLab previews leave out system notes and show 👍 and 👎', () => {
    const {requests} = previewRequests(glIssue);
    assert.deepEqual(requests.map(r => r.path),
        ['/projects/9/issues/3', '/projects/9/issues/3/notes?sort=asc&order_by=created_at&per_page=100']);
    const details = parseGitLabDetails({description: 'd', author: {username: 'omer'}, upvotes: 2, downvotes: 0, user_notes_count: 1},
        [{body: 'changed the title', system: true}, {body: 'real', author: {username: 'amy'}}]);
    assert.equal(details.body, 'd');
    assert.deepEqual(details.reactions, [{emoji: '👍', count: 2}]);
    assert.deepEqual(details.comments.map(c => c.body), ['real']);
    assert.equal(details.more, 0);
});

test('drafts preview only their description', () => {
    assert.deepEqual(previewRequests(draft).requests, [draftDetailsRequest(draft)]);
    assert.equal(draftDetailsRequest(draft).body.variables.draft, 'DI_1');
    assert.deepEqual(parseDraftDetails({data: {node: {body: 'plan', creator: {login: 'me'}}}}),
        {body: 'plan', author: 'me', createdAt: null, reactions: [], comments: [], more: 0});
    assert.throws(() => draftDetailsRequest({...draft, draftId: null}), TypeError);
});

test('bodyRequests replace the description on each platform', () => {
    assert.deepEqual(bodyRequest(issue, 'new'), {method: 'PATCH', path: '/repos/octo/app/issues/42', body: {body: 'new'}});
    assert.deepEqual(gitlabBodyRequest(glIssue, ''), {method: 'PUT', path: '/projects/9/issues/3', body: {description: ''}});
    assert.deepEqual(draftBodyRequest(draft, 'x').body.variables, {draft: 'DI_1', body: 'x'});
    assert.deepEqual(bodyRequests(issue, 'x'.repeat(70000)), []);
    assert.equal(bodyRequests(glIssue, 'ok').length, 1);
});
