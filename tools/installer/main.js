// sourceglance Setup entry point: `gjs -m main.js [options]` (AppRun runs this inside the AppImage).
// Static imports only: a top-level `await import()` would wait forever, since no main loop
// is running yet. Importing GTK doesn't open a display, so CLI mode still works headless.
import GLib from 'gi://GLib';
import System from 'system';

import {runCli} from './lib/cli.js';
import {EXIT, parseArgs, usage} from './lib/plan.js';
import {packageMetadata} from './lib/system.js';
import {runWizard} from './lib/wizard.js';

function main() {
    const opts = parseArgs(System.programArgs);

    if (opts.error) {
        printerr(`${opts.error}\n\n${usage()}`);
        return EXIT.USAGE;
    }
    if (opts.action === 'help') {
        print(usage());
        return EXIT.OK;
    }
    if (opts.action === 'version') {
        print(packageMetadata()?.['version-name'] ?? 'unknown');
        return EXIT.OK;
    }
    if (opts.quiet || opts.action === 'check' || opts.action === 'extract') {
        const loop = new GLib.MainLoop(null, false);
        let code = EXIT.FAILED;
        runCli(opts)
            .then(c => {
                code = c;
            })
            .catch(e => printerr(`Setup failed: ${e.message}`))
            .finally(() => loop.quit());
        loop.run();
        return code;
    }
    if (!GLib.getenv('WAYLAND_DISPLAY') && !GLib.getenv('DISPLAY')) {
        printerr('No graphical session found. For a terminal install, run with --quiet --accept-license (see --help).');
        return EXIT.FAILED;
    }
    return runWizard(opts);
}

System.exit(main());
