// Command-line mode (design: Command-line use). No GTK is loaded here.
import {EXIT, allChecksPass, decideMode, evaluateChecks} from './plan.js';
import {
    Log, PAYLOAD_EXTENSION_DIR, extensionDir, gatherFacts, installedVersion, licenseText,
    mkdirp, packageMetadata, run, tildify,
} from './system.js';
import {install, remove} from './operations.js';

async function systemCheck(meta) {
    const checks = evaluateChecks(await gatherFacts(), meta['shell-version'] ?? [], meta['version-name']);
    for (const c of checks)
        print(c.ok ? `  ✓ ${c.title}` : `  ✗ ${c.title} — ${c.message}`);
    return checks;
}

/** Run a non-wizard action; resolves to an exit code. */
export async function runCli(opts) {
    const meta = packageMetadata() ?? {};
    const version = meta['version-name'] ?? '?';

    if (opts.action === 'extract') {
        mkdirp(opts.extractDir);
        const result = await run(['cp', '-R', '--', `${PAYLOAD_EXTENSION_DIR}/.`, opts.extractDir]);
        if (result.status !== 0) {
            printerr(`Could not extract: ${result.stderr.trim()}`);
            return EXIT.FAILED;
        }
        print(`Extracted sourceglance ${version} to ${opts.extractDir}`);
        return EXIT.OK;
    }

    if (opts.action === 'check') {
        print(`System check for sourceglance ${version}:`);
        return allChecksPass(await systemCheck(meta)) ? EXIT.OK : EXIT.FAILED;
    }

    const log = new Log(opts.logFile);
    log.listeners.push(line => print(line));
    try {
        if (opts.action === 'uninstall') {
            const facts = await gatherFacts();
            if (facts.isRoot) {
                printerr('Run Setup as your normal user, without sudo.');
                return EXIT.FAILED;
            }
            if (installedVersion() === null) {
                print('sourceglance is not installed. Nothing to do.');
                return EXIT.OK;
            }
            await remove({log});
            print('Log out and back in to finish.');
            return EXIT.OK;
        }

        // install / repair (quiet, license accepted on the command line)
        print(licenseText());
        print('License accepted with --accept-license: sourceglance is provided AS IS, without warranty of any kind.\n');
        print(`System check for sourceglance ${version}:`);
        if (!allChecksPass(await systemCheck(meta))) {
            printerr('Setup stopped: fix the problems above and try again. Nothing was changed.');
            return EXIT.FAILED;
        }
        const mode = decideMode(installedVersion(), version);
        if (opts.action === 'repair' && mode !== 'maintain')
            log.write(`Note: --repair with ${mode === 'install' ? 'nothing installed' : `version ${installedVersion()} installed`}; installing ${version}`);
        const {restarted} = await install({enableAfter: true, log});
        print(`\nsourceglance ${version} is installed in ${tildify(extensionDir())}.`);
        print(restarted
            ? 'It is running the new version now; no need to log out.'
            : 'Log out and back in to start it, then open its Settings from the top bar to sign in.');
        return EXIT.OK;
    } catch (e) {
        printerr(`Setup failed: ${e.message}${e.rolledBack ? ' (previous version restored)' : ''}`);
        printerr(`Log: ${tildify(log.path)}`);
        return EXIT.FAILED;
    } finally {
        log.close();
    }
}
