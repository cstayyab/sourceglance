import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
    SYNCED_SETTINGS,
    accountKey,
    agreedAfterSync,
    authFromSecret,
    canonicalJson,
    classifyTokenResponse,
    cleanSyncedSettings,
    decideSettings,
    deleteAccountRequest,
    deviceCodeRequest,
    deviceLabel,
    hintsFor,
    isValidAccessToken,
    parseDeviceCode,
    parsePrompts,
    parseServerUrl,
    parseState,
    planAccountSync,
    putAccountRequest,
    putHintsRequest,
    putSettingsRequest,
    secretFor,
    stateRequest,
    tokenFromSecret,
} from '../src/lib/sync.js';

const fp = text => `fp(${text})`;
const TOKEN = `sgd_${'a'.repeat(30)}`;

test('parseServerUrl allows https anywhere and http only on this computer', () => {
    assert.deepEqual(parseServerUrl('https://sourceglance.example.com/'), {url: 'https://sourceglance.example.com'});
    assert.deepEqual(parseServerUrl('sourceglance.example.com'), {url: 'https://sourceglance.example.com'});
    assert.deepEqual(parseServerUrl('http://localhost:5173'), {url: 'http://localhost:5173'});
    assert.deepEqual(parseServerUrl('http://127.0.0.1:3000'), {url: 'http://127.0.0.1:3000'});
    assert.deepEqual(parseServerUrl('http://[::1]:3000'), {url: 'http://[::1]:3000'});
    assert.equal(parseServerUrl('http://sourceglance.example.com').error, 'insecure');
    assert.equal(parseServerUrl('http://192.168.1.5:3000').error, 'insecure');
    assert.equal(parseServerUrl('https://user:pw@x.example.com').error, 'credentials');
    assert.equal(parseServerUrl('https://x.example.com/some/path').error, 'path');
    assert.equal(parseServerUrl('ftp://x.example.com').error, 'insecure');
    assert.equal(parseServerUrl('').error, 'empty');
});

test('access tokens must look like the server issues them', () => {
    assert.equal(isValidAccessToken(TOKEN), true);
    assert.equal(isValidAccessToken('sgd_short'), false);
    assert.equal(isValidAccessToken('ghp_' + 'a'.repeat(30)), false);
    assert.equal(isValidAccessToken(null), false);
});

test('requests carry the bearer token and a JSON body', () => {
    const base = 'https://s.example.com';
    const code = deviceCodeRequest(base, 'My laptop');
    assert.equal(code.method, 'POST');
    assert.equal(code.url, 'https://s.example.com/api/device/code');
    assert.equal(code.headers.authorization, undefined);
    assert.deepEqual(JSON.parse(code.body), {deviceName: 'My laptop'});
    const state = stateRequest(base, TOKEN);
    assert.equal(state.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(state.body, null);
    assert.equal(stateRequest(base, TOKEN, {tokens: false}).url, 'https://s.example.com/api/sync/state?tokens=0');
    assert.deepEqual(JSON.parse(putAccountRequest(base, TOKEN, {platform: 'github', base: 'https://github.com', token: 't'}).body),
        {platform: 'github', base: 'https://github.com', token: 't'});
    assert.equal(deleteAccountRequest(base, TOKEN, 'a/b').url, 'https://s.example.com/api/sync/accounts/a%2Fb');
    assert.deepEqual(JSON.parse(putSettingsRequest(base, TOKEN, 3, {'group-by': 'platform'}).body), {revision: 3, data: {'group-by': 'platform'}});
});

test('parseDeviceCode opens the server\'s own page, with no code in the link', () => {
    const ok = {deviceCode: 'd'.repeat(43), userCode: 'ABCD-EFGH', verificationUrl: 'https://s.example.com/device', interval: 5, expiresIn: 600};
    assert.equal(parseDeviceCode(ok, 'https://s.example.com').userCode, 'ABCD-EFGH');
    assert.equal(parseDeviceCode(ok, 'https://s.example.com').link, 'https://s.example.com/device');
    assert.equal(parseDeviceCode({...ok, verificationUrl: 'https://evil.example/device'}, 'https://s.example.com'), null);
    assert.equal(parseDeviceCode({...ok, deviceCode: 'short'}, 'https://s.example.com'), null);
    assert.equal(parseDeviceCode({...ok, verificationUrl: 'javascript:alert(1)'}, 'https://s.example.com'), null);
    assert.equal(parseDeviceCode({...ok, interval: 1}, 'https://s.example.com').interval, 2);
    assert.equal(parseDeviceCode(null, 'https://s.example.com'), null);
});

test('classifyTokenResponse maps the polling answers', () => {
    assert.deepEqual(classifyTokenResponse(200, {accessToken: TOKEN, email: 'a@b.c'}), {kind: 'ok', token: TOKEN, email: 'a@b.c'});
    assert.equal(classifyTokenResponse(200, {accessToken: 'nope'}).kind, 'error');
    assert.equal(classifyTokenResponse(400, {error: 'authorization_pending'}).kind, 'pending');
    assert.equal(classifyTokenResponse(400, {error: 'slow_down'}).kind, 'slow-down');
    assert.equal(classifyTokenResponse(400, {error: 'expired_token'}).kind, 'expired');
    assert.equal(classifyTokenResponse(400, {error: 'access_denied'}).kind, 'denied');
    assert.equal(classifyTokenResponse(500, null).kind, 'error');
});

const stateJson = (over = {}) => ({
    user: {email: 'a@b.c'},
    plan: {id: 'individual', seats: 1, withinLimits: true, problems: []},
    accounts: [{id: 'acc-1', platform: 'github', base: 'https://github.com', login: 'alice', token: 'tok'}],
    settings: {revision: 2, data: {'group-by': 'platform'}},
    ...over,
});

test('parseState checks every field', () => {
    const state = parseState(stateJson());
    assert.equal(state.email, 'a@b.c');
    assert.equal(state.plan.name, 'Individual');
    assert.deepEqual(state.accounts[0], {id: 'acc-1', platform: 'github', base: 'https://github.com', login: 'alice', token: 'tok', method: 'pat', expiresAt: null});
    const device = parseState(stateJson({accounts: [{id: 'g', platform: 'gitlab', base: 'https://gitlab.com', login: 'a', token: 't', method: 'device', expiresAt: 1700000000000, refresh: 'never-read'}]}));
    assert.deepEqual(device.accounts[0], {id: 'g', platform: 'gitlab', base: 'https://gitlab.com', login: 'a', token: 't', method: 'device', expiresAt: 1700000000000});
    assert.equal(state.settings.revision, 2);
    assert.equal(parseState(stateJson({accounts: [{id: 'x', platform: 'github', base: 'http://evil', login: 'a', token: 't'}]})) === null, false);
    assert.equal(parseState(stateJson({accounts: [{id: 'x', platform: 'bitbucket', base: 'https://x.io', login: 'a', token: 't'}]})), null);
    assert.equal(parseState(stateJson({accounts: [{id: 'x', platform: 'github', base: 'https://github.com/', login: 'a', token: 't'}]})), null);
    assert.equal(parseState(stateJson({settings: {revision: -1, data: {}}})), null);
    assert.equal(parseState(stateJson({plan: {id: 'galactic'}})).plan, null);
    assert.equal(parseState('nope'), null);
});

test('parsePrompts accepts the expected shape only', () => {
    const ok = {version: 'v1', work: {intro: 'Do {item}', lines: ['a', 'b']}, suggest: {intro: ['x'], hint: 'h', noHint: 'n'}};
    assert.equal(parsePrompts(ok).version, 'v1');
    assert.equal(parsePrompts({...ok, work: {intro: '', lines: ['a']}}), null);
    assert.equal(parsePrompts({...ok, work: {intro: 'x', lines: []}}), null);
    assert.equal(parsePrompts({...ok, suggest: {intro: [1], hint: 'h', noHint: 'n'}}), null);
    assert.equal(parsePrompts({...ok, work: {intro: 'x', lines: ['a'.repeat(2001)]}}), null);
    assert.equal(parsePrompts(null), null);
});

const local = (login, token, method = 'pat') => ({id: `github:github.com:${login}`, platform: 'github', base: 'https://github.com', login, method, token});
const remote = (login, token) => ({platform: 'github', base: 'https://github.com', login, token});

test('accounts only on the server are pulled, only here are pushed', () => {
    const plan = planAccountSync([local('mine', 't1')], [remote('theirs', 't2')], {}, fp);
    assert.deepEqual(plan.pull.map(a => a.login), ['theirs']);
    assert.deepEqual(plan.push.map(a => a.login), ['mine']);
});

test('browser sign-ins travel like tokens, and accounts without a login never do', () => {
    const plan = planAccountSync([local('device', 't', 'device'), local('', 't')], [], {}, fp);
    assert.deepEqual(plan.push.map(a => a.login), ['device']);
    assert.deepEqual([plan.pull, plan.removeRemote, plan.kept], [[], [], []]);
});

test('a renewed browser sign-in comes back from the server, which is the only one renewing it', () => {
    const key = accountKey(remote('a', ''));
    const plan = planAccountSync([local('a', 'old', 'device')], [remote('a', 'renewed')], {[key]: fp('old')}, fp);
    assert.deepEqual(plan.pull.map(a => a.token), ['renewed']);
    assert.deepEqual(plan.push, []);
});

test('putAccountRequest hands a browser sign-in over with its refresh token, and a personal token without', () => {
    const device = JSON.parse(putAccountRequest('https://s.example.com', TOKEN, {platform: 'gitlab', base: 'https://gitlab.com', token: 'acc',
        method: 'device', refresh: 'ref', expiresAt: 5, clientId: null}).body);
    assert.deepEqual(device, {platform: 'gitlab', base: 'https://gitlab.com', token: 'acc', method: 'device', refresh: 'ref', expiresAt: 5, clientId: null});
    const pat = JSON.parse(putAccountRequest('https://s.example.com', TOKEN, {platform: 'github', base: 'https://github.com', token: 'pat', method: 'pat', refresh: 'x'}).body);
    assert.deepEqual(pat, {platform: 'github', base: 'https://github.com', token: 'pat'});
});

test('authFromSecret reads the whole sign-in out of the keyring form', () => {
    assert.deepEqual(authFromSecret('github', 'ghu'), {token: 'ghu', refresh: null, expiresAt: null});
    assert.deepEqual(authFromSecret('gitlab', JSON.stringify({access: 'a', refresh: 'r', expiresAt: 9})), {token: 'a', refresh: 'r', expiresAt: 9});
    assert.deepEqual(authFromSecret('gitlab', secretFor('gitlab', 'a', {expiresAt: 7})), {token: 'a', refresh: null, expiresAt: 7});
    assert.equal(authFromSecret('gitlab', 'not json'), null);
    assert.equal(authFromSecret('github', null), null);
});

test('the key ignores the login case', () => {
    assert.equal(accountKey(local('Alice', 't')), accountKey(remote('alice', 't')));
    assert.deepEqual(planAccountSync([local('Alice', 't')], [remote('alice', 't')], {}, fp), {pull: [], push: [], removeRemote: [], kept: []});
});

test('a token changed only here is pushed; changed on the server or on both, the server wins', () => {
    const key = accountKey(remote('a', ''));
    assert.deepEqual(planAccountSync([local('a', 'new')], [remote('a', 'old')], {[key]: fp('old')}, fp).push.map(a => a.token), ['new']);
    assert.deepEqual(planAccountSync([local('a', 'old')], [remote('a', 'newer')], {[key]: fp('old')}, fp).pull.map(a => a.token), ['newer']);
    const both = planAccountSync([local('a', 'mine')], [remote('a', 'theirs')], {[key]: fp('old')}, fp);
    assert.deepEqual([both.pull.map(a => a.token), both.push], [['theirs'], []]);
    // Never agreed: the server's.
    assert.deepEqual(planAccountSync([local('a', 'x')], [remote('a', 'y')], {}, fp).pull.map(a => a.token), ['y']);
});

test('an account removed here since the last sync is removed there; one removed there is kept here and not sent again', () => {
    const key = accountKey(remote('gone', ''));
    const removed = planAccountSync([], [remote('gone', 't')], {[key]: fp('t')}, fp);
    assert.deepEqual(removed.removeRemote.map(a => a.login), ['gone']);
    assert.deepEqual(removed.pull, []);
    const kept = planAccountSync([local('gone', 't')], [], {[key]: fp('t')}, fp);
    assert.deepEqual(kept.kept.map(a => a.login), ['gone']);
    assert.deepEqual(kept.push, []);
});

test('an account whose token can\'t be read is still here: never removed on the server, never sent, and refilled from it', () => {
    const key = accountKey(remote('locked', ''));
    const unreadable = {...local('locked', 't'), token: null};
    const plan = planAccountSync([unreadable], [remote('locked', 't')], {[key]: fp('t')}, fp);
    assert.deepEqual([plan.removeRemote, plan.push, plan.kept], [[], [], []]);
    assert.deepEqual(plan.pull.map(a => a.login), ['locked']);
    // Only here, with no token: nothing to send, nothing to keep.
    assert.deepEqual(planAccountSync([unreadable], [], {}, fp), {pull: [], push: [], removeRemote: [], kept: []});
});

test('agreedAfterSync fingerprints each account', () => {
    assert.deepEqual(agreedAfterSync([remote('a', 't')], fp), {[accountKey(remote('a', ''))]: 'fp(t)'});
});

test('secrets: GitHub keeps the token, GitLab a JSON that never renews', () => {
    assert.equal(secretFor('github', 'tok'), 'tok');
    assert.deepEqual(JSON.parse(secretFor('gitlab', 'tok')), {access: 'tok', refresh: null, expiresAt: null});
    assert.equal(tokenFromSecret('github', 'tok'), 'tok');
    assert.equal(tokenFromSecret('gitlab', secretFor('gitlab', 'tok')), 'tok');
    assert.equal(tokenFromSecret('gitlab', 'not json'), null);
    assert.equal(tokenFromSecret('github', ''), null);
});

test('only the settings that follow you are kept, in the right shape', () => {
    const clean = cleanSyncedSettings({
        'group-by': 'platform', 'organization-names': {a: 'A'}, 'hidden-boards': ['x'], 'ai-instructions': 'Use pnpm.',
        'ai-provider': 'claude', 'repo-folders': {a: '/home/a'}, 'hidden-boards-bad': 1,
    });
    assert.deepEqual(Object.keys(clean).sort(), ['ai-instructions', 'group-by', 'hidden-boards', 'organization-names']);
    assert.deepEqual(cleanSyncedSettings({'group-by': 5, 'project-boards': 'x', 'project-repos': {a: 1}}), {});
    assert.ok(!('ai-provider' in SYNCED_SETTINGS));
    assert.ok(!('repo-folders' in SYNCED_SETTINGS));
});

test('canonicalJson ignores key order', () => {
    assert.equal(canonicalJson({b: 1, a: [2, {d: 1, c: 2}]}), canonicalJson({a: [2, {c: 2, d: 1}], b: 1}));
    assert.notEqual(canonicalJson({a: 1}), canonicalJson({a: 2}));
});

test('settings: apply when the server moved, push when only we changed, nothing otherwise', () => {
    const hash = text => `h(${text})`;
    const local = {'group-by': 'platform'};
    const lastHash = hash(canonicalJson(local));
    assert.deepEqual(decideSettings({local, remote: {revision: 3, data: {'group-by': 'project'}}, lastRevision: 2, lastHash, hash}),
        {action: 'apply', data: {'group-by': 'project'}, revision: 3});
    assert.deepEqual(decideSettings({local: {'group-by': 'organization'}, remote: {revision: 2, data: local}, lastRevision: 2, lastHash, hash}),
        {action: 'push', data: {'group-by': 'organization'}, revision: 2});
    assert.deepEqual(decideSettings({local, remote: {revision: 2, data: local}, lastRevision: 2, lastHash, hash}), {action: 'none'});
    // Both changed: the server's wins.
    assert.equal(decideSettings({local: {'group-by': 'organization'}, remote: {revision: 4, data: {}}, lastRevision: 2, lastHash, hash}).action, 'apply');
});

test('deviceLabel uses a safe host name', () => {
    assert.equal(deviceLabel('work-laptop'), 'Source Glance on work-laptop');
    assert.equal(deviceLabel('bad name; rm'), 'Source Glance on Computer');
});

test('hintsFor lists every browser sign-in, travelling or not, and never carries a token', () => {
    const accounts = [
        {id: 'a', platform: 'github', base: 'https://github.com', login: 'me', method: 'device', clientId: null, token: 'secret'},
        {id: 'b', platform: 'gitlab', base: 'https://git.example.com', login: 'me', method: 'device', clientId: 'cid'},
        {id: 'c', platform: 'github', base: 'https://github.com', login: 'tok', method: 'pat', clientId: null},
        {id: 'd', platform: 'github', base: 'https://github.com', login: null, method: 'device', clientId: null},
    ];
    assert.deepEqual(hintsFor(accounts), [
        {platform: 'github', base: 'https://github.com', login: 'me', clientId: null},
        {platform: 'gitlab', base: 'https://git.example.com', login: 'me', clientId: 'cid'},
    ]);
    const request = putHintsRequest('https://s.example.com', TOKEN, hintsFor(accounts));
    assert.equal(request.method, 'PUT');
    assert.equal(request.url, 'https://s.example.com/api/sync/hints');
    assert.doesNotMatch(request.body, /secret/);
});
