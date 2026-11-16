// System facts and helpers for the setup wizard (GJS).
// External tools always run with an argv array, never through a shell (threat model T16).
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {UUID, parseExtensionInfo, parseManifest, parseShellMajor} from './plan.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const HERE = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);

export const PAYLOAD_DIR = GLib.getenv('SOURCEGLANCE_SETUP_PAYLOAD') ??
    GLib.build_filenamev([HERE, '..', 'payload']);
export const PAYLOAD_EXTENSION_DIR = GLib.build_filenamev([PAYLOAD_DIR, 'extension']);
export const SETTINGS_PATH = '/org/gnome/shell/extensions/sourceglance/';

export function extensionsDir() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions']);
}

export function extensionDir() {
    return GLib.build_filenamev([extensionsDir(), UUID]);
}

export function setupCacheDir() {
    return GLib.build_filenamev([GLib.get_user_cache_dir(), 'sourceglance-setup']);
}

export function backupsDir() {
    return GLib.build_filenamev([setupCacheDir(), 'backups']);
}

/** Path with $HOME shown as ~ (for display only). */
export function tildify(path) {
    const home = GLib.get_home_dir();
    return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function timestamp() {
    return GLib.DateTime.new_now_local().format('%Y%m%d-%H%M%S');
}

/** Run a command; resolves to {status, stdout, stderr}. status 127 if it can't start. */
export async function run(argv) {
    let proc;
    try {
        proc = Gio.Subprocess.new(argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    } catch (e) {
        return {status: 127, stdout: '', stderr: e.message};
    }
    const [stdout, stderr] = await proc.communicate_utf8_async(null, null);
    return {status: proc.get_exit_status(), stdout: stdout ?? '', stderr: stderr ?? ''};
}

export async function runOrThrow(argv) {
    const result = await run(argv);
    if (result.status !== 0)
        throw new Error(`${argv[0]} failed: ${result.stderr.trim() || `exit ${result.status}`}`);
    return result;
}

export function exists(path) {
    return GLib.file_test(path, GLib.FileTest.EXISTS);
}

export function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : null;
    } catch {
        return null;
    }
}

export function readJson(path) {
    const text = readText(path);
    try {
        return text === null ? null : JSON.parse(text);
    } catch {
        return null;
    }
}

export function mkdirp(path) {
    GLib.mkdir_with_parents(path, 0o700);
}

export function packageMetadata() {
    return readJson(GLib.build_filenamev([PAYLOAD_EXTENSION_DIR, 'metadata.json']));
}

export function licenseText() {
    return readText(GLib.build_filenamev([PAYLOAD_DIR, 'LICENSE'])) ?? '';
}

/** Installed version-name, '0.0.0' if installed without one, or null if not installed. */
export function installedVersion() {
    if (!exists(extensionDir()))
        return null;
    const meta = readJson(GLib.build_filenamev([extensionDir(), 'metadata.json']));
    return meta?.['version-name'] ?? '0.0.0';
}

export async function isRoot() {
    const {stdout} = await run(['id', '-u']);
    return stdout.trim() === '0';
}

export async function shellMajor() {
    const {status, stdout} = await run(['gnome-shell', '--version']);
    return status === 0 ? parseShellMajor(stdout) : null;
}

export function shellSettings() {
    const source = Gio.SettingsSchemaSource.get_default();
    return source?.lookup('org.gnome.shell', true) ? new Gio.Settings({schema_id: 'org.gnome.shell'}) : null;
}

export function userExtensionsDisabled() {
    return shellSettings()?.get_boolean('disable-user-extensions') ?? false;
}

export function setUserExtensionsEnabled() {
    const settings = shellSettings();
    settings?.set_boolean('disable-user-extensions', false);
    Gio.Settings.sync();
}

/**
 * The running GNOME Shell's view of sourceglance ({state, path}), or null when no Shell is
 * reachable or it doesn't know the extension (it learns about new extensions at login).
 */
export async function shellExtensionInfo() {
    const result = await run(['gnome-extensions', 'info', UUID]);
    return result.status === 0 ? parseExtensionInfo(result.stdout) : null;
}

function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

async function waitForState(done) {
    let state = null;
    for (let i = 0; i < 20; i++) {
        state = (await shellExtensionInfo())?.state ?? null;
        if (done(state))
            break;
        await sleep(250);
    }
    return state;
}

/**
 * Turns sourceglance off and on in the running GNOME Shell, so it runs the version just
 * installed (the loader imports it from its own folder). Resolves to true once it's running.
 */
export async function restartInShell() {
    await run(['gnome-extensions', 'disable', UUID]);
    // Enabling before the Shell has finished disabling is ignored.
    await waitForState(state => state !== 'ACTIVE');
    await run(['gnome-extensions', 'enable', UUID]);
    return await waitForState(state => state === 'ACTIVE' || state === 'ERROR') === 'ACTIVE';
}

/** Turn the extension on or off for the next login (enabled-extensions / disabled-extensions). */
export function setExtensionEnabled(enabled) {
    const settings = shellSettings();
    if (!settings)
        return false;
    const without = key => settings.get_strv(key).filter(id => id !== UUID);
    settings.set_strv('enabled-extensions', enabled ? [...without('enabled-extensions'), UUID] : without('enabled-extensions'));
    if (settings.settings_schema.has_key('disabled-extensions'))
        settings.set_strv('disabled-extensions', enabled ? without('disabled-extensions') : [...without('disabled-extensions'), UUID]);
    Gio.Settings.sync();
    return true;
}

export function freeBytes() {
    try {
        const info = Gio.File.new_for_path(GLib.get_home_dir())
            .query_filesystem_info('filesystem::free', null);
        return Number(info.get_attribute_uint64('filesystem::free'));
    } catch {
        return null;
    }
}

function listFiles(root, prefix = '') {
    const files = [];
    const dir = Gio.File.new_for_path(GLib.build_filenamev([root, prefix]));
    const children = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    let info;
    while ((info = children.next_file(null))) {
        const rel = prefix ? `${prefix}/${info.get_name()}` : info.get_name();
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            files.push(...listFiles(root, rel));
        else
            files.push(rel);
    }
    return files;
}

/**
 * Verify the packaged extension against manifest.sha256: every listed file must match its
 * hash, and no unlisted files may be present.
 */
export function verifyPayload() {
    const manifest = parseManifest(readText(GLib.build_filenamev([PAYLOAD_DIR, 'manifest.sha256'])) ?? '');
    if (!manifest)
        return false;
    try {
        for (const {hash, path} of manifest) {
            const [ok, bytes] = GLib.file_get_contents(GLib.build_filenamev([PAYLOAD_EXTENSION_DIR, path]));
            if (!ok || GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes) !== hash)
                return false;
        }
        const listed = new Set(manifest.map(e => e.path));
        const actual = listFiles(PAYLOAD_EXTENSION_DIR);
        return actual.length === listed.size && actual.every(f => listed.has(f));
    } catch {
        return false;
    }
}

/** Collect the facts evaluateChecks() needs. */
export async function gatherFacts() {
    return {
        isRoot: await isRoot(),
        shellMajor: await shellMajor(),
        integrityOk: verifyPayload(),
        userExtensionsDisabled: userExtensionsDisabled(),
        freeBytes: freeBytes(),
    };
}

/** Appends to the setup log file and notifies listeners (the wizard's details view). */
export class Log {
    constructor(path = null) {
        this.path = path ?? GLib.build_filenamev([setupCacheDir(), 'setup.log']);
        this.listeners = [];
        try {
            mkdirp(GLib.path_get_dirname(this.path));
            this._stream = Gio.File.new_for_path(this.path).append_to(Gio.FileCreateFlags.PRIVATE, null);
        } catch {
            this._stream = null;
        }
    }

    write(message) {
        const line = `${GLib.DateTime.new_now_local().format('%H:%M:%S')}  ${message}`;
        try {
            this._stream?.write_all(new TextEncoder().encode(`${line}\n`), null);
        } catch {
            // Logging must never break setup.
        }
        for (const listener of this.listeners)
            listener(line);
    }

    close() {
        try {
            this._stream?.close(null);
        } catch {
            // ignore
        }
        this._stream = null;
    }
}
