import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
    allTasks,
    asTask,
    filterDraftsBy,
    filterGroupsBy,
    filterTasks,
    listBadge,
    searchCount,
    taskCounts,
    taskFilterGroups,
    taskFilterOptions,
    toggleTaskFilter,
} from '../src/lib/model.js';

const item = (kind, repo, number, updatedAt, extra = {}) => ({
    kind, repo, number, updatedAt, title: `${kind} ${number}`, url: `https://github.com/${repo}/${kind === 'pr' ? 'pull' : 'issues'}/${number}`,
    labels: [], assignees: [], ...extra,
});
const source = (extra = {}) => ({
    status: 'ready', updatedAt: '2026-11-18T10:00:00Z', platform: 'github',
    groups: [], prGroups: [], boards: [], issueTotal: 0, issueShown: 0, prTotal: 0, prShown: 0, ...extra,
});

const work = source({
    key: 'github.com', title: 'GitHub · @me', assignee: '@me · GitHub',
    groups: [{repo: 'octo/app', issues: [item('issue', 'octo/app', 1, '2026-11-18T09:00:00Z', {labels: [{name: 'bug'}]})]}],
    prGroups: [{repo: 'octo/api', issues: [item('pr', 'octo/api', 7, '2026-11-18T11:00:00Z')]}],
    boards: [{title: 'Roadmap', url: 'https://github.com/users/me/projects/1', drafts: [{itemId: 'D1', title: 'Plan launch', status: 'Todo'}]}],
});
const gitlab = source({
    key: 'gitlab.com', title: 'GitLab · @me', platform: 'gitlab',
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

const kind = value => ({type: 'kind', value});
const account = value => ({type: 'account', value});

test('filterTasks: kinds add up, accounts add up, kinds and accounts narrow', () => {
    const tasks = allTasks([work, gitlab]);
    assert.equal(filterTasks(tasks, []).length, 4);
    assert.deepEqual(filterTasks(tasks, [kind('issue')]).map(task => task.ref), ['#1', '#3']);
    assert.deepEqual(filterTasks(tasks, [kind('pr'), kind('draft')]).map(task => task.ref || task.title), ['#7', 'Plan launch']);
    assert.deepEqual(filterTasks(tasks, [account('gitlab.com')]).map(task => task.ref), ['#3']);
    assert.equal(filterTasks(tasks, [account('gitlab.com'), account('github.com')]).length, 4);
    assert.deepEqual(filterTasks(tasks, [kind('issue'), account('github.com')]).map(task => task.ref), ['#1']);
    assert.deepEqual(filterTasks(tasks, [kind('pr'), account('gitlab.com')]), []);
});

test('filterTasks also matches search words', () => {
    const tasks = allTasks([work, gitlab]);
    assert.deepEqual(filterTasks(tasks, [], ['bug']).map(task => task.ref), ['#1']);
    assert.deepEqual(filterTasks(tasks, [], ['roadmap']).map(task => task.title), ['Plan launch']);
    assert.deepEqual(filterTasks(tasks, [kind('pr')], ['bug']), []);
});

test('tasks know their account', () => {
    const tasks = allTasks([work, gitlab]);
    assert.deepEqual(tasks.map(task => task.accountTitle), ['GitHub · @me', 'GitHub · @me', 'GitLab · @me', 'GitHub · @me']);
});

test('taskFilterOptions offers kinds, accounts only with several, and skips active filters', () => {
    const tasks = allTasks([work, gitlab]);
    const label = option => `${option.type}:${option.value}:${option.count}`;
    assert.deepEqual(taskFilterOptions(tasks, [work, gitlab]).map(label),
        ['kind:issue:2', 'kind:pr:1', 'kind:draft:1', 'account:github.com:3', 'account:gitlab.com:1']);
    assert.deepEqual(taskFilterOptions(allTasks([work]), [work]).map(label), ['kind:issue:1', 'kind:pr:1', 'kind:draft:1']);
    assert.deepEqual(taskFilterOptions(tasks, [work, gitlab], [kind('pr'), account('gitlab.com')]).map(label),
        ['kind:issue:2', 'kind:draft:1', 'account:github.com:3']);
    assert.equal(taskFilterOptions(tasks, [work, gitlab]).at(3).title, '@me · GitHub');
    // Without an assignee name, the account's title.
    assert.equal(taskFilterOptions(tasks, [work, gitlab]).at(-1).title, 'GitLab · @me');
});

test('taskCounts, and Tasks in the sidebar counts and search counts', () => {
    assert.deepEqual(taskCounts(allTasks([work, gitlab])), {all: 4, issue: 2, pr: 1, draft: 1});
    const state = {sources: [work, gitlab]};
    assert.equal(listBadge('tasks', state), '4');
    assert.equal(searchCount('tasks', state, ['octo']), 2);
    assert.equal(listBadge('tasks', {sources: [source({updatedAt: null, status: 'loading'})]}), '');
});

const assigned = source({
    key: 'github.com', title: 'GitHub · @me', assignee: '@me · GitHub',
    groups: [{repo: 'octo/app', issues: [
        item('issue', 'octo/app', 1, '2026-11-18T09:00:00Z', {labels: [{name: 'bug'}, {name: 'ui'}], assignees: ['me', 'amy']}),
        item('issue', 'octo/app', 2, '2026-11-18T08:00:00Z', {labels: [{name: 'bug'}], assignees: ['me']}),
    ]}],
    boards: [{title: 'Roadmap', url: null, drafts: [{itemId: 'D1', title: 'Plan', status: null,
        assignees: [{id: 'U_1', login: 'amy'}]}]}],
});

test('taskFilterGroups lists every choice of each kind, with counts and what is checked', () => {
    const tasks = allTasks([assigned, gitlab]);
    const label = option => `${option.value}:${option.count}${option.active ? '*' : ''}`;
    const groups = taskFilterGroups(tasks, [assigned, gitlab], [{type: 'label', value: 'bug'}, {type: 'kind', value: 'pr'}]);
    assert.deepEqual(groups.kind.map(label), ['issue:3', 'pr:0*', 'draft:1']);
    assert.deepEqual(groups.account.map(label), ['github.com:3', 'gitlab.com:1']);
    assert.equal(groups.account[0].title, '@me · GitHub');
    assert.deepEqual(groups.label.map(label), ['bug:2*', 'ui:1']);
    assert.deepEqual(groups.assignee.map(label), ['amy:2', 'me:2']);
    // One account still gets the Accounts menu.
    assert.equal(taskFilterGroups(allTasks([assigned]), [assigned]).account.length, 1);
});

test('filterTasks by label and assignee: each adds up within its kind and narrows across', () => {
    const tasks = allTasks([assigned, gitlab]);
    const ref = task => task.ref || task.title;
    assert.deepEqual(filterTasks(tasks, [{type: 'label', value: 'ui'}]).map(ref), ['#1']);
    assert.deepEqual(filterTasks(tasks, [{type: 'label', value: 'ui'}, {type: 'label', value: 'bug'}]).map(ref), ['#1', '#2']);
    assert.deepEqual(filterTasks(tasks, [{type: 'assignee', value: 'amy'}]).map(ref), ['#1', 'Plan']);
    assert.deepEqual(filterTasks(tasks, [{type: 'assignee', value: 'amy'}, {type: 'label', value: 'bug'}]).map(ref), ['#1']);
});

test('toggleTaskFilter adds a filter or takes it off', () => {
    const bug = {type: 'label', value: 'bug', title: 'bug'};
    assert.deepEqual(toggleTaskFilter([], bug), [bug]);
    assert.deepEqual(toggleTaskFilter([bug, kind('pr')], {type: 'label', value: 'bug'}), [kind('pr')]);
});

test('filterGroupsBy and filterDraftsBy apply the filter bar to the lists by kind', () => {
    const groups = assigned.groups;
    const label = value => ({type: 'label', value});
    const person = value => ({type: 'assignee', value});
    assert.equal(filterGroupsBy(groups, []), groups);
    assert.deepEqual(filterGroupsBy(groups, [label('ui')]).map(g => g.issues.map(i => i.number)), [[1]]);
    assert.deepEqual(filterGroupsBy(groups, [label('nope')]), []);
    assert.deepEqual(filterGroupsBy(groups, [label('bug'), person('amy')]).map(g => g.issues.map(i => i.number)), [[1]]);
    const board = assigned.boards[0];
    assert.equal(filterDraftsBy(board, []), board);
    assert.deepEqual(filterDraftsBy(board, [person('amy')]).drafts.map(d => d.itemId), ['D1']);
    assert.deepEqual(filterDraftsBy(board, [person('me')]).drafts, []);
    assert.deepEqual(asTask(board.drafts[0]).kind, 'draft');
    assert.deepEqual(asTask(groups[0].issues[0]).kind, 'issue');
});
