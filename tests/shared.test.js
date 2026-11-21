import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, existsSync} from 'node:fs';
import path from 'node:path';

// src/shared must stay free of GNOME, so that plain Node can load it (as these tests do) as well as GJS.
const dir = new URL('../src/shared/', import.meta.url).pathname;
const files = readdirSync(dir).filter(name => name.endsWith('.js'));

test('src/shared has the shared modules', () => {
    for (const name of ['model', 'accounts', 'projects', 'names', 'markdown', 'requests', 'gitlabModel', 'repoAccess', 'aiAgents', 'sync'])
        assert.ok(files.includes(`${name}.js`), `${name}.js`);
});

test('src/shared imports nothing from GNOME', () => {
    for (const name of files) {
        const source = readFileSync(path.join(dir, name), 'utf8');
        assert.ok(!/from\s+'(gi|resource|system):?/.test(source) && !/imports\.gi|imports\.system/.test(source), `${name} imports GNOME`);
        assert.ok(!/\b(GLib|Gio|Gtk|Soup|Adw|Secret)\./.test(source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), `${name} uses a GNOME object`);
    }
});

test('src/shared imports only files in src/shared', () => {
    for (const name of files) {
        const source = readFileSync(path.join(dir, name), 'utf8');
        for (const match of source.matchAll(/^import[^;]*?from '([^']+)';/gms)) {
            assert.ok(match[1].startsWith('./'), `${name} imports ${match[1]}`);
            assert.ok(existsSync(path.join(dir, match[1])), `${name} imports a missing ${match[1]}`);
        }
    }
});

test('src/lib keeps a re-export for every moved module, so no import in the desktop changed', () => {
    const lib = new URL('../src/lib/', import.meta.url).pathname;
    for (const name of files.filter(f => f !== 'README.md')) {
        const stub = path.join(lib, name);
        assert.ok(existsSync(stub), `src/lib/${name}`);
        assert.match(readFileSync(stub, 'utf8'), new RegExp(`export \\* from '\\.\\./shared/${name}';`));
    }
});
