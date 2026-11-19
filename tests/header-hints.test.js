import {test} from 'node:test';
import assert from 'node:assert/strict';

import {fetchProblem, problemFix} from '../src/lib/accounts.js';

test('fetchProblem: none without accounts or when every account loaded', () => {
    assert.equal(fetchProblem([]), null);
    assert.equal(fetchProblem([{status: 'ready', title: 'GitHub', error: null}]), null);
});

test('fetchProblem: the first failing account, with its kind and retry time', () => {
    const sources = [
        {status: 'ready', title: 'GitHub', error: null},
        {status: 'error', title: 'GitLab · me', error: {kind: 'rate-limit', retryAt: 1000}},
        {status: 'error', title: 'Other', error: {kind: 'network', retryAt: null}},
    ];
    assert.deepEqual(fetchProblem(sources), {kind: 'rate-limit', title: 'GitLab · me', retryAt: 1000});
});

test('fetchProblem: a signed-out account and an error without a kind', () => {
    assert.equal(fetchProblem([{status: 'signed-out', title: 'GitHub'}]).kind, 'signed-out');
    assert.equal(fetchProblem([{status: 'error', title: 'GitHub', error: null}]).kind, 'unknown');
});

test('problemFix: sign-in and access problems go to Accounts, the rest retry', () => {
    for (const kind of ['auth', 'signed-out', 'forbidden', 'insecure', 'not-found', 'gone'])
        assert.equal(problemFix(kind), 'accounts');
    for (const kind of ['network', 'rate-limit', 'unknown'])
        assert.equal(problemFix(kind), 'retry');
});
