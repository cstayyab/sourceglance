// Pure decision logic for the setup wizard. No gi:// imports: unit-tested with Node.

export const UUID = 'sourceglance@omer-gh.github.io';
export const MIN_FREE_BYTES = 5 * 1024 * 1024;
export const BACKUPS_TO_KEEP = 3;

export const EXIT = {OK: 0, FAILED: 1, USAGE: 2, CANCELLED: 3};

/** Compare "1.2.3" style versions numerically. Returns -1, 0 or 1. */
export function compareVersions(a, b) {
    const parts = v => String(v).split(/[.-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0);
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++) {
        if ((x[i] ?? 0) !== (y[i] ?? 0))
            return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
    }
    return 0;
}

/**
 * What Setup should offer, given the installed version (or null) and the packaged one.
 * install: nothing installed · upgrade: older installed · maintain: same version ·
 * downgrade: newer installed.
 */
export function decideMode(installedVersion, packageVersion) {
    if (!installedVersion)
        return 'install';
    const cmp = compareVersions(installedVersion, packageVersion);
    if (cmp < 0)
        return 'upgrade';
    if (cmp === 0)
        return 'maintain';
    return 'downgrade';
}

/** "GNOME Shell 50.1" → 50 */
export function parseShellMajor(versionOutput) {
    const match = /GNOME Shell (\d+)/.exec(versionOutput ?? '');
    return match ? Number.parseInt(match[1], 10) : null;
}

export function isShellSupported(major, shellVersions) {
    return major !== null && shellVersions.map(String).includes(String(major));
}

/** "46".."50" for messages. */
export function describeShellRange(shellVersions) {
    const nums = shellVersions.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (nums.length === 0)
        return '';
    return nums.length === 1 ? String(nums[0]) : `${nums[0]}–${nums[nums.length - 1]}`;
}

/**
 * Turn raw system facts into the System Check rows.
 * facts: {isRoot, shellMajor, integrityOk, userExtensionsDisabled, freeBytes}
 */
export function evaluateChecks(facts, shellVersions, packageVersion) {
    const range = describeShellRange(shellVersions);
    return [
        {
            id: 'user',
            title: 'Running as your normal user',
            ok: !facts.isRoot,
            message: 'Run Setup as your normal user, without sudo. sourceglance installs only for you.',
        },
        {
            id: 'shell',
            title: `GNOME Shell ${range}`,
            ok: isShellSupported(facts.shellMajor, shellVersions),
            message: facts.shellMajor === null
                ? 'GNOME Shell was not found. sourceglance only runs on the GNOME desktop.'
                : `sourceglance ${packageVersion} supports GNOME Shell ${range}. You have ${facts.shellMajor}.`,
        },
        {
            id: 'integrity',
            title: 'Setup file is intact',
            ok: facts.integrityOk,
            message: 'The setup file is damaged. Download it again.',
        },
        {
            id: 'extensions',
            title: 'User extensions are allowed',
            ok: !facts.userExtensionsDisabled,
            message: 'User extensions are turned off.',
            fix: 'enable-user-extensions',
        },
        {
            id: 'disk',
            title: 'Enough free disk space',
            ok: facts.freeBytes === null || facts.freeBytes >= MIN_FREE_BYTES,
            message: 'Not enough free disk space in your home folder.',
        },
    ];
}

export function allChecksPass(checks) {
    return checks.every(c => c.ok);
}

/**
 * Wizard pages for a mode and (in maintenance) the user's choice.
 * The last page is the result page; 'failed' replaces it when an operation fails.
 */
export function flowFor(mode, choice = null) {
    const fullInstall = ['welcome', 'license', 'risks', 'options', 'check', 'ready', 'progress', 'done'];
    const remove = ['maintenance', 'remove-options', 'ready-remove', 'progress', 'removed'];
    switch (mode) {
    case 'install':
    case 'upgrade':
        return fullInstall;
    case 'maintain':
        if (choice === 'remove')
            return remove;
        return ['maintenance', 'check', 'ready', 'progress', 'done'];
    case 'downgrade':
        if (choice === 'remove')
            return remove;
        return ['maintenance', 'license', 'risks', 'options', 'check', 'ready', 'progress', 'done'];
    default:
        throw new Error(`Unknown mode: ${mode}`);
    }
}

/** The operation a flow ends in: install (incl. upgrade/repair/downgrade) or remove. */
export function operationFor(mode, choice) {
    return (mode === 'maintain' || mode === 'downgrade') && choice === 'remove' ? 'remove' : 'install';
}

/** Human summary for the Ready page. */
export function readySummary({mode, choice, packageVersion, installedVersion, enableAfter, extensionDir}) {
    if (operationFor(mode, choice) === 'remove') {
        return [
            `Remove sourceglance ${installedVersion} from ${extensionDir}`,
            'Keep a backup copy in ~/.cache/sourceglance-setup/backups',
            'Turn sourceglance off',
        ];
    }
    const lines = [`Copy sourceglance ${packageVersion} to ${extensionDir}`];
    if (installedVersion) {
        const verb = {upgrade: 'Replace', downgrade: 'Replace', maintain: 'Repair'}[mode] ?? 'Replace';
        lines.push(`${verb} sourceglance ${installedVersion}; your settings and saved token are kept`);
        lines.push('Keep a backup of the current version in ~/.cache/sourceglance-setup/backups');
    }
    if (enableAfter)
        lines.push('Turn on sourceglance for your next login');
    return lines;
}

/** Backups older than the newest `keep` (names sort by timestamp). */
export function backupsToPrune(names, keep = BACKUPS_TO_KEEP) {
    return [...names].sort().reverse().slice(keep);
}

/**
 * `gnome-extensions info` output → {state: 'ACTIVE', path: '/home/…/<uuid>'}; fields it
 * doesn't show are null.
 */
export function parseExtensionInfo(text) {
    const field = name => new RegExp(`^\\s*${name}:\\s*(.+)$`, 'm').exec(text ?? '')?.[1]?.trim() ?? null;
    return {state: field('State'), path: field('Path')};
}

/** Parse "sha256sum"-format manifest text into [{hash, path}]. */
export function parseManifest(text) {
    const entries = [];
    for (const line of text.split('\n')) {
        if (!line.trim())
            continue;
        const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
        if (!match || match[2].includes('..') || match[2].startsWith('/'))
            return null;
        entries.push({hash: match[1], path: match[2]});
    }
    return entries.length > 0 ? entries : null;
}

const USAGE = `Usage: sourceglance-Setup.AppImage [options]

With no options, opens the setup wizard.

  --quiet --accept-license  Install (or upgrade/repair) without the wizard.
                            Prints the MIT License; by passing --accept-license you
                            accept it, including that there is NO WARRANTY.
  --repair                  Reinstall the packaged version (add --quiet --accept-license)
  --uninstall               Remove sourceglance (add --quiet for no wizard)
  --check                   Run the system check only; change nothing
  --extract DIR             Copy the packaged extension files to DIR; change nothing
  --log FILE                Write the setup log to FILE
  --version                 Print the packaged sourceglance version
  --help                    Show this help

Exit codes: 0 success, 1 failed, 2 bad usage, 3 cancelled.`;

export function usage() {
    return USAGE;
}

/** Parse command-line arguments. Returns {action, quiet, acceptLicense, extractDir, logFile} or {error}. */
export function parseArgs(argv) {
    const opts = {action: 'wizard', quiet: false, acceptLicense: false, extractDir: null, logFile: null};
    const setAction = a => {
        if (opts.action !== 'wizard' && opts.action !== a)
            return 'Choose only one of --repair, --uninstall, --check, --extract, --version, --help.';
        opts.action = a;
        return null;
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        let err = null;
        switch (arg) {
        case '--quiet': opts.quiet = true; break;
        case '--accept-license': opts.acceptLicense = true; break;
        case '--repair': err = setAction('repair'); break;
        case '--uninstall': err = setAction('uninstall'); break;
        case '--check': err = setAction('check'); break;
        case '--version': err = setAction('version'); break;
        case '--help': case '-h': err = setAction('help'); break;
        case '--extract':
            err = setAction('extract');
            opts.extractDir = argv[++i] ?? null;
            if (!opts.extractDir)
                err = '--extract needs a directory.';
            break;
        case '--log':
            opts.logFile = argv[++i] ?? null;
            if (!opts.logFile)
                err = '--log needs a file name.';
            break;
        default:
            err = `Unknown option: ${arg}`;
        }
        if (err)
            return {error: err};
    }
    if (opts.quiet && opts.action === 'wizard')
        opts.action = 'install';
    if (opts.quiet && (opts.action === 'install' || opts.action === 'repair') && !opts.acceptLicense)
        return {error: '--quiet installs need --accept-license (after reading the MIT License).'};
    return opts;
}
