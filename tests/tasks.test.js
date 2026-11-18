import {test} from 'node:test';
import assert from 'node:assert/strict';

import {allTasks, filterTasks, listBadge, searchCount, taskCounts} from '../src/lib/model.js';

const item = (kind, repo, number, updatedAt, extra = {}) => ({
    kind, repo, number, updatedAt, title: `${kind} ${number}`, url: `https://github.com/${repo}/${kind === 'pr' ? 'pull' : 'issues'}/${number}`,
    labels: [], assignees: [], ...extra,
});
const source = (extra = {}) => ({
    status: 'ready', updatedAt: '2026-11-18T10:00:00Z', platform: 'github',
    groups: [], prGroups: [], boards: [], issueTotal: 0, issueShown: 0, prTotal: 0, prShown: 0, ...extra,
});

const work = source({
    groups: [{repo: 'octo/app', issues: [item('issue', 'octo/app', 1, '2026-11-18T09:00:00Z', {labels: [{name: 'bug'}]})]}],
    prGroups: [{repo: 'octo/api', issues: [item('pr', 'octo/api', 7, '2026-11-18T11:00:00Z')]}],
    boards: [{title: 'Roadmap', url: 'https://github.com/users/me/projects/1', drafts: [{itemId: 'D1', title: 'Plan launch', status: 'Todo'}]}],
});
const gitlab = source({
    platform: 'gitlab',
    groups: [{repo: 'group/web', issues: [item('issue', 'group/web', 3, '2026-11-17T08:00:00Z', {platform: 'gitlab',
        url: 'https://gitlab.com/group/web/-/issues/3'})]}],
    boards: null,
});

test('allTasks puts every account\'s issues, PRs and drafts in one list, newest first, drafts last', () => {
    const tasks = allTasks([work, gitlab]);
    assert.deepEqual(tasks.map(task => `${task.kind}:${task.ref || task.title}`),
        ['pr:#7', 'issue:#1', 'issue:#3', 'draft:Plan launch']);
    const draft = tasks.at(-1);
    assert.equal(draft.url, 'https://github.com/users/me/projects/1');
    assert.equal(draft.repo, 'Roadmap');
    assert.equal(tasks[0].repo, 'octo/api');
});

test('allTasks skips signed-out accounts and shows an item two accounts share once', () => {
    const shared = source({groups: work.groups});
    assert.equal(allTasks([work, shared]).length, 3);
    assert.equal(allTasks([source({status: 'signed-out', groups: work.groups})]).length, 0);
    assert.deepEqual(allTasks(null), []);
});

test('filterTasks filters by kind and by search words', () => {
    const tasks = allTasks([work, gitlab]);
    assert.equal(filterTasks(tasks, null).length, 4);
    assert.deepEqual(filterTasks(tasks, 'issue').map(task => task.ref), ['#1', '#3']);
    assert.deepEqual(filterTasks(tasks, 'pr').map(task => task.ref), ['#7']);
    assert.deepEqual(filterTasks(tasks, 'draft').map(task => task.title), ['Plan launch']);
    assert.deepEqual(filterTasks(tasks, null, ['bug']).map(task => task.ref), ['#1']);
    assert.deepEqual(filterTasks(tasks, null, ['roadmap']).map(task => task.title), ['Plan launch']);
    assert.deepEqual(filterTasks(tasks, 'pr', ['bug']), []);
});

test('taskCounts, and Tasks in the sidebar counts and search counts', () => {
    assert.deepEqual(taskCounts(allTasks([work, gitlab])), {all: 4, issue: 2, pr: 1, draft: 1});
    const state = {sources: [work, gitlab]};
    assert.equal(listBadge('tasks', state), '4');
    assert.equal(searchCount('tasks', state, ['octo']), 2);
    assert.equal(listBadge('tasks', {sources: [source({updatedAt: null, status: 'loading'})]}), '');
});
