import {test} from 'node:test';
import assert from 'node:assert/strict';

import {availableUpdate, compareVersions, newestRelease, parseVersion} from '../src/lib/updates.js';

test('parseVersion accepts plain X.Y.Z with an optional v', () => {
    assert.deepEqual(parseVersion('v0.2.0'), [0, 2, 0]);
    assert.deepEqual(parseVersion('1.10.3'), [1, 10, 3]);
    assert.equal(parseVersion('dev'), null);
    assert.equal(parseVersion('v1.2.3-rc1'), null);
    assert.equal(parseVersion(null), null);
});

test('compareVersions compares numerically, not as text', () => {
    assert.ok(compareVersions([0, 10, 0], [0, 9, 9]) > 0);
    assert.ok(compareVersions([1, 0, 0], [1, 0, 1]) < 0);
    assert.equal(compareVersions([2, 3, 4], [2, 3, 4]), 0);
});

test('newestRelease picks the highest version and skips drafts and odd tags', () => {
    const json = [
        {tag_name: 'v0.2.0'},
        {tag_name: 'v0.10.0', draft: true},
        {tag_name: 'v0.3.0-rc1'},
        {tag_name: 'v0.3.0', prerelease: true},
        {tag_name: 'v0.1.0'},
        null,
    ];
    const newest = newestRelease(json);
    assert.deepEqual([newest.version, newest.parts], ['0.3.0', [0, 3, 0]]);
    assert.equal(newest.release, json[3]);
    assert.equal(newestRelease([]), null);
    assert.equal(newestRelease({message: 'rate limited'}), null);
});

test('availableUpdate only reports a newer release', () => {
    const json = [{tag_name: 'v0.3.0'}, {tag_name: 'v0.2.0'}];
    assert.equal(availableUpdate(json, '0.2.0'), '0.3.0');
    assert.equal(availableUpdate(json, '0.3.0'), null);
    assert.equal(availableUpdate(json, '0.4.0'), null);
    assert.equal(availableUpdate(json, 'dev'), null);
    assert.equal(availableUpdate([], '0.2.0'), null);
});

test('findUpdate returns the release object for the newer version', async () => {
    const {findUpdate} = await import('../src/lib/updates.js');
    const newer = {tag_name: 'v0.3.0', assets: []};
    assert.equal(findUpdate([newer, {tag_name: 'v0.2.0'}], '0.2.0').release, newer);
    assert.equal(findUpdate([newer], '0.3.0'), null);
});

test('normalizeArch maps uname -m to Setup names', async () => {
    const {normalizeArch} = await import('../src/lib/updates.js');
    assert.equal(normalizeArch('x86_64\n'), 'x86_64');
    assert.equal(normalizeArch('arm64'), 'aarch64');
    assert.equal(normalizeArch('riscv64'), null);
});

test('setupAsset and checksumsAsset only accept this repository\'s release downloads', async () => {
    const {setupAsset, checksumsAsset} = await import('../src/lib/updates.js');
    const base = 'https://github.com/omer-gh/sourceglance/releases/download/v0.3.0/';
    const release = {assets: [
        {name: 'sourceglance-Setup-0.3.0-x86_64.AppImage', browser_download_url: `${base}sourceglance-Setup-0.3.0-x86_64.AppImage`},
        {name: 'sourceglance-Setup-0.3.0-aarch64.AppImage', browser_download_url: 'https://evil.example/setup.AppImage'},
        {name: 'SHA256SUMS', browser_download_url: `${base}SHA256SUMS`},
    ]};
    assert.deepEqual(setupAsset(release, '0.3.0', 'x86_64'),
        {name: 'sourceglance-Setup-0.3.0-x86_64.AppImage', url: `${base}sourceglance-Setup-0.3.0-x86_64.AppImage`});
    assert.equal(setupAsset(release, '0.3.0', 'aarch64'), null);
    assert.equal(setupAsset(release, '../0.3.0', 'x86_64'), null);
    assert.equal(setupAsset(release, '0.3.0', 'riscv64'), null);
    assert.equal(checksumsAsset(release).url, `${base}SHA256SUMS`);
    assert.equal(checksumsAsset({assets: []}), null);
});

test('parseChecksums reads sha256sum output', async () => {
    const {parseChecksums} = await import('../src/lib/updates.js');
    const a = 'A'.repeat(64);
    const b = 'b'.repeat(64);
    const sums = parseChecksums(`${a}  sourceglance-Setup-0.3.0-x86_64.AppImage\n${b} *SHA-file\nnot a line\n${'c'.repeat(63)}  short\n${b}  ../evil`);
    assert.equal(sums.get('sourceglance-Setup-0.3.0-x86_64.AppImage'), 'a'.repeat(64));
    assert.equal(sums.get('SHA-file'), b);
    assert.equal(sums.size, 2);
});
