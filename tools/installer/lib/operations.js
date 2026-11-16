// Install and remove, with backup and rollback (design: Installing, Maintenance mode).
import GLib from 'gi://GLib';
import Secret from 'gi://Secret';

import {UUID, backupsToPrune} from './plan.js';
import {
    PAYLOAD_EXTENSION_DIR, SETTINGS_PATH, backupsDir, exists, extensionDir, extensionsDir,
    installedVersion, mkdirp, packageMetadata, readJson, restartInShell, run, runOrThrow,
    setExtensionEnabled, shellExtensionInfo, timestamp, tildify, verifyPayload,
} from './system.js';

export class SetupError extends Error {
    constructor(message, {rolledBack = false} = {}) {
        super(message);
        this.name = 'SetupError';
        this.rolledBack = rolledBack;
    }
}

function backupPath(label) {
    return GLib.build_filenamev([backupsDir(), `${timestamp()}-${label}`]);
}

async function move(from, to) {
    await runOrThrow(['mv', '--', from, to]);
}

async function pruneBackups(log) {
    if (!exists(backupsDir()))
        return;
    const {stdout} = await run(['ls', '-1', '--', backupsDir()]);
    for (const name of backupsToPrune(stdout.split('\n').filter(Boolean))) {
        log.write(`Removing old backup ${name}`);
        await run(['rm', '-rf', '--', GLib.build_filenamev([backupsDir(), name])]);
    }
}

async function resetSettings(log) {
    log.write('Resetting sourceglance settings');
    const result = await run(['dconf', 'reset', '-f', SETTINGS_PATH]);
    if (result.status !== 0)
        log.write(`Could not reset settings (${result.stderr.trim() || 'dconf unavailable'})`);
}

/**
 * After an update, run the new version in this session without logging out. Only when the
 * old install already had the loader (versions/current): older versions run their code from
 * the top-level files, which GNOME Shell keeps in memory until the next login. And only when
 * the running Shell has this very folder enabled.
 */
async function startNewVersion({hadLoader, target, log, progress}) {
    if (!hadLoader)
        return false;
    const info = await shellExtensionInfo();
    if (info?.state !== 'ACTIVE' || info.path !== target)
        return false;
    progress(0.9, 'Starting the new version…');
    const restarted = await restartInShell();
    log.write(restarted
        ? 'sourceglance restarted with the new version; no need to log out'
        : 'sourceglance could not be restarted; it starts with the new version at your next login');
    return restarted;
}

/**
 * Install, upgrade, repair or downgrade to the packaged version.
 * progress(fraction, text) is called before each step.
 * Resolves to {restarted}: true when the new version is already running (no log-out needed).
 */
export async function install({enableAfter = true, reset = false, log, progress = () => {}}) {
    const target = extensionDir();
    const version = packageMetadata()?.['version-name'];
    const previous = installedVersion();
    const hadLoader = exists(GLib.build_filenamev([target, 'versions', 'current']));
    let backup = null;
    let staged = false;

    log.write(`Installing sourceglance ${version}${previous ? ` over ${previous}` : ''} to ${tildify(target)}`);
    try {
        progress(0.1, 'Verifying package…');
        if (!verifyPayload())
            throw new SetupError('The setup file is damaged. Download it again.');

        mkdirp(extensionsDir());
        mkdirp(backupsDir());

        if (previous) {
            progress(0.3, 'Backing up previous version…');
            backup = backupPath(`v${previous}`);
            log.write(`Backing up ${previous} to ${tildify(backup)}`);
            await move(target, backup);
        }

        progress(0.5, 'Copying files…');
        const staging = GLib.build_filenamev([extensionsDir(), `.${UUID}.setup-${timestamp()}`]);
        await runOrThrow(['cp', '-R', '--', PAYLOAD_EXTENSION_DIR, staging]);
        staged = true;
        await move(staging, target);
        if (readJson(GLib.build_filenamev([target, 'metadata.json']))?.['version-name'] !== version)
            throw new SetupError('The copied files could not be verified.');
        log.write('Files copied');

        if (reset)
            await resetSettings(log);

        if (enableAfter) {
            progress(0.8, 'Turning on sourceglance…');
            if (setExtensionEnabled(true))
                log.write('sourceglance will start at your next login');
            else
                log.write('GNOME Shell settings not found; turn sourceglance on in the Extensions app');
        }

        progress(0.95, 'Cleaning up…');
        await pruneBackups(log);
        log.write(`sourceglance ${version} installed`);
    } catch (e) {
        log.write(`Error: ${e.message}`);
        const rolledBack = await rollback({target, backup, staged, log});
        throw new SetupError(e.message, {rolledBack});
    }
    // The files are in place; a failed restart only means waiting for the next login.
    const restarted = await startNewVersion({hadLoader, target, log, progress});
    progress(1, 'Done');
    return {restarted};
}

async function rollback({target, backup, staged, log}) {
    try {
        if (staged && exists(target)) {
            const failed = backupPath('failed');
            log.write(`Moving the incomplete install aside to ${tildify(failed)}`);
            await move(target, failed);
        }
        if (backup && exists(backup)) {
            log.write('Restoring the previous version');
            await move(backup, target);
        }
        return Boolean(backup);
    } catch (e) {
        log.write(`Rollback failed: ${e.message}`);
        return false;
    }
}

async function clearToken(log) {
    // Must match src/lib/tokenStore.js (ADR 0002).
    const schema = new Secret.Schema('io.github.omer-gh.sourceglance', Secret.SchemaFlags.NONE,
        {account: Secret.SchemaAttributeType.STRING});
    await new Promise(resolve => {
        Secret.password_clear(schema, {account: 'github.com'}, null, (_src, result) => {
            try {
                Secret.password_clear_finish(result);
                log.write('Deleted the saved GitHub token');
            } catch (e) {
                log.write(`Could not delete the saved token: ${e.message}`);
            }
            resolve();
        });
    });
}

// The app grid icon the extension writes; it points into the extension folder, so it goes
// with it. Must match LAUNCHER_ID in src/lib/model.js.
function removeAppLauncher(log) {
    const path = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications',
        'io.github.omer_gh.sourceglance.desktop']);
    if (GLib.file_test(path, GLib.FileTest.EXISTS) && GLib.unlink(path) === 0)
        log.write(`Removed the app icon ${tildify(path)}`);
}

/** Remove sourceglance, keeping a backup copy. Token and settings removal are opt-in. */
export async function remove({deleteToken = false, reset = false, log, progress = () => {}}) {
    const target = extensionDir();
    const previous = installedVersion();
    log.write(`Removing sourceglance ${previous ?? ''}`);
    try {
        progress(0.2, 'Turning off sourceglance…');
        setExtensionEnabled(false);

        if (exists(target)) {
            progress(0.5, 'Removing files…');
            mkdirp(backupsDir());
            const backup = backupPath(`removed-v${previous}`);
            await move(target, backup);
            log.write(`Moved ${tildify(target)} to ${tildify(backup)}`);
        }
        removeAppLauncher(log);
        if (deleteToken) {
            progress(0.7, 'Deleting saved token…');
            await clearToken(log);
        }
        if (reset)
            await resetSettings(log);

        progress(0.9, 'Cleaning up…');
        await pruneBackups(log);
        progress(1, 'Done');
        log.write('sourceglance removed');
    } catch (e) {
        log.write(`Error: ${e.message}`);
        throw new SetupError(e.message);
    }
}
