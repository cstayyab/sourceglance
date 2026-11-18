import {test} from 'node:test';
import assert from 'node:assert/strict';

import {groupCollapseId, isGroupCollapsed, searchTerms, toggleId} from '../src/lib/model.js';

test('groupCollapseId keys a group by list, platform and repository or board', () => {
    assert.equal(groupCollapseId('issues', 'github', 'octo/app'), 'issues:github:octo/app');
    assert.equal(groupCollapseId('prs', 'gitlab', 'group/sub/app'), 'prs:gitlab:group/sub/app');
    assert.notEqual(groupCollapseId('issues', 'github', 'octo/app'), groupCollapseId('prs', 'github', 'octo/app'));
});

test('toggleId adds a missing id and removes a present one, leaving the rest', () => {
    assert.deepEqual(toggleId([], 'a'), ['a']);
    assert.deepEqual(toggleId(['a', 'b'], 'a'), ['b']);
    assert.deepEqual(toggleId(toggleId(['b'], 'a'), 'a'), ['b']);
    const ids = ['a'];
    toggleId(ids, 'b');
    assert.deepEqual(ids, ['a']);
});

test('isGroupCollapsed follows the setting, but a search expands every group', () => {
    const id = groupCollapseId('issues', 'github', 'octo/app');
    assert.equal(isGroupCollapsed([id], id), true);
    assert.equal(isGroupCollapsed([id], id, []), true);
    assert.equal(isGroupCollapsed([], id), false);
    assert.equal(isGroupCollapsed([id], id, searchTerms('dark mode')), false);
});
