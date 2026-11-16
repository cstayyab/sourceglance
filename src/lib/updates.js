// Update check: is a newer sourceglance release out, and which Setup file updates this PC?
// Pure logic, unit-tested with Node. The window asks GitHub's public releases API (no
// sign-in, nothing about you is sent); updater.js downloads and verifies the file.

export const RELEASES_PATH = '/repos/omer-gh/sourceglance/releases?per_page=20';
// Release files are only ever downloaded from here.
export const DOWNLOAD_PREFIX = 'https://github.com/omer-gh/sourceglance/releases/download/';

const VERSION_RE = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;

/** "v1.2.3" or "1.2.3" → [1, 2, 3]; anything else (e.g. "dev", "1.2.3-rc1") → null. */
export function parseVersion(text) {
    const match = VERSION_RE.exec(String(text ?? '').trim());
    return match ? match.slice(1).map(Number) : null;
}

/** Negative when a < b, 0 when equal, positive when a > b (both from parseVersion). */
export function compareVersions(a, b) {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i])
            return a[i] - b[i];
    }
    return 0;
}

/**
 * The newest published release in a GitHub releases list, by version number (drafts and
 * tags that aren't plain X.Y.Z are skipped): {version: '0.3.0', parts: [0, 3, 0], release}
 * or null.
 */
export function newestRelease(json) {
    let best = null;
    for (const release of Array.isArray(json) ? json : []) {
        if (!release || release.draft)
            continue;
        const parts = parseVersion(release.tag_name);
        if (parts && (!best || compareVersions(parts, best.parts) > 0))
            best = {version: parts.join('.'), parts, release};
    }
    return best;
}

/** The newest release if it's newer than `current` ("0.2.0"); null if up to date or unknown. */
export function findUpdate(json, current) {
    const installed = parseVersion(current);
    const newest = newestRelease(json);
    if (!installed || !newest)
        return null;
    return compareVersions(newest.parts, installed) > 0 ? newest : null;
}

/** The newer version available than `current` ("0.2.0"), or null. */
export function availableUpdate(json, current) {
    return findUpdate(json, current)?.version ?? null;
}

/** `uname -m` → the architecture in Setup file names ('x86_64' or 'aarch64'), or null. */
export function normalizeArch(machine) {
    const value = String(machine ?? '').trim();
    if (value === 'x86_64' || value === 'amd64')
        return 'x86_64';
    if (value === 'aarch64' || value === 'arm64')
        return 'aarch64';
    return null;
}

function releaseAsset(release, name) {
    const asset = (release?.assets ?? []).find(candidate => candidate?.name === name);
    const url = asset?.browser_download_url;
    return typeof url === 'string' && url.startsWith(DOWNLOAD_PREFIX) ? {name, url} : null;
}

/** The release's Setup file for `arch` ({name, url}), or null. */
export function setupAsset(release, version, arch) {
    if (!parseVersion(version) || !normalizeArch(arch))
        return null;
    return releaseAsset(release, `sourceglance-Setup-${version}-${arch}.AppImage`);
}

/** The release's SHA256SUMS file ({name, url}), or null. */
export function checksumsAsset(release) {
    return releaseAsset(release, 'SHA256SUMS');
}

/** `sha256sum` output → Map of file name → lowercase hex digest. */
export function parseChecksums(text) {
    const sums = new Map();
    for (const line of String(text ?? '').split('\n')) {
        const match = /^([0-9a-fA-F]{64}) [ *]([^\s/]+)$/.exec(line.trim());
        if (match)
            sums.set(match[2], match[1].toLowerCase());
    }
    return sums;
}
