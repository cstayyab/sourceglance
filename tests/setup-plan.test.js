import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
    EXIT,
    allChecksPass,
    backupsToPrune,
    canRestartInSession,
    compareVersions,
    decideMode,
    describeShellRange,
    evaluateChecks,
    flowFor,
    parseExtensionInfo,
    isShellSupported,
    operationFor,
    parseArgs,
    parseManifest,
    parseShellMajor,
    readySummary,
} from '../tools/installer/lib/plan.js';

const SHELLS = ['46', '47', '48', '49', '50'];
const GOOD_FACTS = {isRoot: false, shellMajor: 50, integrityOk: true, userExtensionsDisabled: false, freeBytes: 1e9};

test('compareVersions orders numerically', () => {
    assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
    assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
    assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.equal(compareVersions('1.0.0-rc1', '1.0.0'), 0);
});

test('decideMode picks install, upgrade, maintain or downgrade', () => {
    assert.equal(decideMode(null, '0.1.0'), 'install');
    assert.equal(decideMode('0.0.9', '0.1.0'), 'upgrade');
    assert.equal(decideMode('0.1.0', '0.1.0'), 'maintain');
    assert.equal(decideMode('0.2.0', '0.1.0'), 'downgrade');
});

test('parseShellMajor and isShellSupported', () => {
    assert.equal(parseShellMajor('GNOME Shell 50.1\n'), 50);
    assert.equal(parseShellMajor(''), null);
    assert.ok(isShellSupported(46, SHELLS));
    assert.ok(!isShellSupported(45, SHELLS));
    assert.ok(!isShellSupported(null, SHELLS));
    assert.equal(describeShellRange(SHELLS), '46–50');
    assert.equal(describeShellRange(['47']), '47');
});

test('evaluateChecks passes on a good system', () => {
    const checks = evaluateChecks(GOOD_FACTS, SHELLS, '0.1.0');
    assert.equal(checks.length, 5);
    assert.ok(allChecksPass(checks));
});

test('evaluateChecks reports each failure with a message', () => {
    const checks = evaluateChecks(
        {isRoot: true, shellMajor: 45, integrityOk: false, userExtensionsDisabled: true, freeBytes: 1000},
        SHELLS, '0.1.0');
    assert.ok(checks.every(c => !c.ok));
    assert.match(checks.find(c => c.id === 'shell').message, /supports GNOME Shell 46–50\. You have 45\./);
    assert.equal(checks.find(c => c.id === 'extensions').fix, 'enable-user-extensions');
    const noShell = evaluateChecks({...GOOD_FACTS, shellMajor: null}, SHELLS, '0.1.0');
    assert.match(noShell.find(c => c.id === 'shell').message, /not found/);
    assert.ok(evaluateChecks({...GOOD_FACTS, freeBytes: null}, SHELLS, '0.1.0').find(c => c.id === 'disk').ok);
});

test('flowFor builds the right pages', () => {
    assert.deepEqual(flowFor('install'),
        ['welcome', 'license', 'risks', 'options', 'check', 'ready', 'progress', 'done']);
    assert.deepEqual(flowFor('upgrade'), flowFor('install'));
    assert.deepEqual(flowFor('maintain', 'repair'), ['maintenance', 'check', 'ready', 'progress', 'done']);
    assert.deepEqual(flowFor('maintain', 'remove'),
        ['maintenance', 'remove-options', 'ready-remove', 'progress', 'removed']);
    assert.equal(flowFor('downgrade', 'downgrade')[1], 'license');
    assert.throws(() => flowFor('bogus'));
});

test('operationFor maps choices to install or remove', () => {
    assert.equal(operationFor('install', null), 'install');
    assert.equal(operationFor('maintain', 'repair'), 'install');
    assert.equal(operationFor('maintain', 'remove'), 'remove');
    assert.equal(operationFor('downgrade', 'remove'), 'remove');
    assert.equal(operationFor('upgrade', 'remove'), 'install');
});

test('readySummary lists every change', () => {
    const base = {packageVersion: '0.1.0', extensionDir: '~/x', enableAfter: true};
    assert.deepEqual(readySummary({...base, mode: 'install', installedVersion: null}),
        ['Copy sourceglance 0.1.0 to ~/x', 'Turn on sourceglance for your next login']);
    const up = readySummary({...base, mode: 'upgrade', installedVersion: '0.0.9'});
    assert.match(up[1], /^Replace sourceglance 0\.0\.9/);
    assert.match(up[2], /backup/);
    assert.match(readySummary({...base, mode: 'maintain', choice: 'repair', installedVersion: '0.1.0'})[1], /^Repair/);
    assert.match(readySummary({...base, mode: 'maintain', choice: 'remove', installedVersion: '0.1.0'})[0], /^Remove sourceglance 0\.1\.0/);
    assert.equal(readySummary({...base, enableAfter: false, mode: 'install', installedVersion: null}).length, 1);
});

test('backupsToPrune keeps the newest', () => {
    assert.deepEqual(backupsToPrune(['20261101', '20261103', '20261102', '20261104'], 3), ['20261101']);
    assert.deepEqual(backupsToPrune(['a'], 3), []);
});

test('parseManifest accepts sha256sum output and rejects unsafe paths', () => {
    const h = 'a'.repeat(64);
    assert.deepEqual(parseManifest(`${h}  extension.js\n${h}  schemas/x.xml\n`),
        [{hash: h, path: 'extension.js'}, {hash: h, path: 'schemas/x.xml'}]);
    assert.equal(parseManifest(`${h}  ../evil`), null);
    assert.equal(parseManifest(`${h}  /etc/passwd`), null);
    assert.equal(parseManifest('not a manifest'), null);
    assert.equal(parseManifest(''), null);
});

test('parseArgs handles actions, flags and errors', () => {
    assert.equal(parseArgs([]).action, 'wizard');
    assert.deepEqual(parseArgs(['--quiet', '--accept-license']),
        {action: 'install', quiet: true, acceptLicense: true, extractDir: null, logFile: null});
    assert.match(parseArgs(['--quiet']).error, /accept-license/);
    assert.match(parseArgs(['--quiet', '--repair']).error, /accept-license/);
    assert.equal(parseArgs(['--quiet', '--uninstall']).action, 'uninstall');
    assert.equal(parseArgs(['--extract', '/tmp/x']).extractDir, '/tmp/x');
    assert.match(parseArgs(['--extract']).error, /directory/);
    assert.equal(parseArgs(['--log', 'f.log']).logFile, 'f.log');
    assert.match(parseArgs(['--repair', '--uninstall']).error, /only one/);
    assert.match(parseArgs(['--bogus']).error, /Unknown option/);
    assert.equal(EXIT.USAGE, 2);
});

test('parseExtensionInfo reads the state and path', () => {
    const text = `sourceglance@omer-gh.github.io
  Name: sourceglance
  Path: /home/me/.local/share/gnome-shell/extensions/sourceglance@omer-gh.github.io
  Version: 0.3.0 (3)
  Enabled: Yes
  State: ACTIVE
`;
    assert.deepEqual(parseExtensionInfo(text),
        {state: 'ACTIVE', path: '/home/me/.local/share/gnome-shell/extensions/sourceglance@omer-gh.github.io'});
    assert.deepEqual(parseExtensionInfo(''), {state: null, path: null});
});

test('canRestartInSession only restarts when the running Shell has the Setup loader', () => {
    const target = '/home/u/.local/share/gnome-shell/extensions/sourceglance@omer-gh.github.io';
    const ok = {hadLoader: true, hadDevBuild: false, info: {state: 'ACTIVE', path: target}, target};
    assert.ok(canRestartInSession(ok));
    assert.ok(!canRestartInSession({...ok, hadLoader: false}), 'older layout: code is in memory until login');
    assert.ok(!canRestartInSession({...ok, hadDevBuild: true}), 'make reload: its loader may be in memory');
    assert.ok(!canRestartInSession({...ok, info: {state: 'ERROR', path: target}}));
    assert.ok(!canRestartInSession({...ok, info: {state: 'ACTIVE', path: '/elsewhere'}}));
    assert.ok(!canRestartInSession({...ok, info: null}));
});
