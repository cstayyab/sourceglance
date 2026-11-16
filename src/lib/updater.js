// Updates sourceglance with its one Setup file. Setup carries the whole release inside it
// and never downloads anything itself, so updating means: download the newest Setup for
// this PC into a private temporary folder, check it against the release's SHA256SUMS, and
// only then run it. Its wizard sees the older installation and upgrades it in place.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {checksumsAsset, findUpdate, normalizeArch, parseChecksums, parseVersion, setupAsset} from './updates.js';

const UUID = 'sourceglance@omer-gh.github.io';

export class UpdateError extends Error {
    /** `kind` is 'up-to-date', 'unsupported', 'missing' or 'checksum'. */
    constructor(kind, detail = '') {
        super(`update ${kind}${detail ? `: ${detail}` : ''}`);
        this.kind = kind;
    }
}

/** This PC's architecture in Setup file names ('x86_64' or 'aarch64'), or null. */
export function machineArch() {
    try {
        const [, out] = GLib.spawn_command_line_sync('uname -m');
        return normalizeArch(new TextDecoder().decode(out));
    } catch {
        return null;
    }
}

/**
 * Downloads and verifies the newest Setup if it's newer than `installed` ("0.2.0").
 * Resolves to {version, path}: a checked, executable file in a new private temp folder.
 *
 * @param {GitHubClient} client
 */
export async function downloadVerifiedSetup(client, installed, cancellable = null) {
    const update = findUpdate(await client.listReleases(cancellable), installed);
    if (!update)
        throw new UpdateError('up-to-date');
    const arch = machineArch();
    if (!arch)
        throw new UpdateError('unsupported');
    const setup = setupAsset(update.release, update.version, arch);
    const sumsFile = checksumsAsset(update.release);
    if (!setup || !sumsFile)
        throw new UpdateError('missing', 'release files');

    const sums = parseChecksums(new TextDecoder().decode((await client.download(sumsFile.url, cancellable)).toArray()));
    const expected = sums.get(setup.name);
    if (!expected)
        throw new UpdateError('missing', `no checksum for ${setup.name}`);
    const bytes = await client.download(setup.url, cancellable);
    const actual = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes);
    if (actual !== expected)
        throw new UpdateError('checksum', setup.name);

    // A new 0700 folder only you can write to, so the checked file can't be swapped.
    const dir = GLib.dir_make_tmp('sourceglance-update-XXXXXX');
    const file = Gio.File.new_for_path(GLib.build_filenamev([dir, setup.name]));
    file.replace_contents(bytes.toArray(), null, false, Gio.FileCreateFlags.PRIVATE, cancellable);
    file.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NONE, cancellable);
    return {version: update.version, path: file.get_path()};
}

/** Opens the Setup wizard; resolves to true once it finishes successfully. */
export function runSetup(path) {
    const proc = Gio.Subprocess.new([path], Gio.SubprocessFlags.NONE);
    return new Promise(resolve => proc.wait_check_async(null, (_proc, result) => {
        try {
            resolve(proc.wait_check_finish(result));
        } catch {
            resolve(false); // cancelled, failed or closed
        }
    }));
}

/** The version installed for you now ("0.3.0"), read from disk, or null. */
export function installedVersion() {
    const dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', UUID]);
    const read = path => {
        try {
            return new TextDecoder().decode(GLib.file_get_contents(path)[1]);
        } catch {
            return null;
        }
    };
    const current = read(GLib.build_filenamev([dir, 'versions', 'current']))?.trim();
    if (parseVersion(current))
        return current;
    try {
        const version = JSON.parse(read(GLib.build_filenamev([dir, 'metadata.json'])) ?? '')['version-name'];
        return parseVersion(version) ? version : null;
    } catch {
        return null;
    }
}

/**
 * Opens the window again a moment after this one closes: by then its process has quit (it
 * stops 2 s after its last window), so the new window loads the newly installed version.
 */
export function reopenWindowSoon() {
    Gio.Subprocess.new(['sh', '-c', 'sleep 3; exec gnome-extensions prefs "$0"', UUID], Gio.SubprocessFlags.NONE);
}
