// Source Glance Cloud (or a server you run yourself): sign in once on a server and your accounts, the
// settings that follow you and the AI instructions come with you. This file builds the requests, checks
// every answer and decides what to pull and what to push. Pure (no GNOME imports); lib/syncService.js
// sends them.
//
// Trust: the server is the one you chose. An answer is parsed field by field before anything uses it, a
// link it hands back must stay on the server's own address, and nothing it sends is run or shown as markup.

import {GITHUB_COM, GITLAB_COM, PLATFORMS, accountId, parseInstanceUrl} from './accounts.js';

/** The hosted service. Any other server (one on this computer, or your own) is entered as an address. */
export const CLOUD_SERVER = 'https://sourceglance.mohammadomer.com';

export const SERVER_CHOICES = [
    {id: 'cloud', url: CLOUD_SERVER},
    {id: 'custom', url: ''},
];

/** The plans, as the server describes them (for the Settings page's summary; the server enforces them). */
export const PLAN_NAMES = {individual: 'Individual', startup: 'Startup', enterprise: 'Enterprise'};

const TOKEN_RE = /^sgd_[A-Za-z0-9_-]{20,100}$/;
const DEVICE_CODE_RE = /^[A-Za-z0-9_-]{20,200}$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A server address typed by the user, as its origin: {url} or {error} ('empty', 'invalid', 'insecure',
 * 'credentials', 'path'). https:// anywhere; http:// only for this computer (localhost, 127.0.0.1, ::1),
 * because a sign-in token must not cross a network in clear text.
 */
export function parseServerUrl(text) {
    const parsed = parseInstanceUrl(text);
    if (parsed.error)
        return {error: parsed.error === 'scheme' ? 'insecure' : parsed.error};
    if (parsed.path)
        return {error: 'path'};
    if (parsed.scheme === 'http' && !LOOPBACK.has(parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname))
        return {error: 'insecure'};
    return {url: parsed.base};
}

export function isValidAccessToken(token) {
    return typeof token === 'string' && TOKEN_RE.test(token);
}

// Requests: {method, url, headers, body (a string or null)}.

const JSON_HEADERS = {'content-type': 'application/json', accept: 'application/json'};

function json(method, base, path, body, token = null) {
    return {
        method,
        url: `${base}${path}`,
        headers: {...JSON_HEADERS, ...token ? {authorization: `Bearer ${token}`} : {}},
        body: body === null ? null : JSON.stringify(body),
    };
}

export const deviceCodeRequest = (base, deviceName) =>
    json('POST', base, '/api/device/code', {deviceName: String(deviceName).slice(0, 80) || 'Desktop'});
export const deviceTokenRequest = (base, deviceCode) => json('POST', base, '/api/device/token', {deviceCode});
/** `tokens: false` asks the server not to send any account token (token backup is off on this computer). */
export const stateRequest = (base, token, {tokens = true} = {}) =>
    json('GET', base, `/api/sync/state${tokens ? '' : '?tokens=0'}`, null, token);
export const promptsRequest = (base, token) => json('GET', base, '/api/ai/prompts', null, token);
export const signOutRequest = (base, token) => json('POST', base, '/api/sync/signout', {}, token);
export const putAccountRequest = (base, token, {platform, base: instance, token: secret}) =>
    json('PUT', base, '/api/sync/accounts', {platform, base: instance, token: secret}, token);
export const deleteAccountRequest = (base, token, id) =>
    json('DELETE', base, `/api/sync/accounts/${encodeURIComponent(id)}`, null, token);
export const putSettingsRequest = (base, token, revision, data) =>
    json('PUT', base, '/api/sync/settings', {revision, data}, token);

// Answers.

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

/** The start of a device sign-in, or null. `base` is the server: the link must stay on it. */
export function parseDeviceCode(json, base) {
    if (!isObject(json) || !DEVICE_CODE_RE.test(json.deviceCode ?? '') || !isText(json.userCode, 20))
        return null;
    // The page to open is the server's own (same scheme, host and port); the person types the code there themselves.
    const link = parseInstanceUrl(String(json.verificationUrl));
    const server = parseInstanceUrl(base);
    if (link.error || server.error || link.scheme !== server.scheme || link.hostname !== server.hostname || link.port !== server.port)
        return null;
    const interval = Number.isInteger(json.interval) ? Math.min(30, Math.max(2, json.interval)) : 5;
    const expiresIn = Number.isInteger(json.expiresIn) ? Math.min(1800, Math.max(30, json.expiresIn)) : 600;
    return {deviceCode: json.deviceCode, userCode: json.userCode, link: link.base, interval, expiresIn};
}

/** What polling for the token said: {kind: 'ok', token, email} or 'pending', 'slow-down', 'expired', 'denied', 'error'. */
export function classifyTokenResponse(status, json) {
    if (status === 200 && isObject(json) && isValidAccessToken(json.accessToken))
        return {kind: 'ok', token: json.accessToken, email: isText(json.email, 254) ? json.email : ''};
    switch (isObject(json) ? json.error : null) {
    case 'authorization_pending':
        return {kind: 'pending'};
    case 'slow_down':
        return {kind: 'slow-down'};
    case 'expired_token':
        return {kind: 'expired'};
    case 'access_denied':
        return {kind: 'denied'};
    default:
        return {kind: 'error', status};
    }
}

function parsePlan(plan) {
    if (!isObject(plan) || !(plan.id in PLAN_NAMES))
        return null;
    return {
        id: plan.id,
        name: PLAN_NAMES[plan.id],
        seats: Number.isInteger(plan.seats) ? plan.seats : 1,
        withinLimits: plan.withinLimits !== false,
        problems: Array.isArray(plan.problems) ? plan.problems.filter(p => isText(p, 300)).slice(0, 5) : [],
    };
}

/** The server's account of this device, or null: {email, plan, accounts, settings}. */
export function parseState(json) {
    if (!isObject(json) || !isObject(json.user) || !isObject(json.settings) || !Array.isArray(json.accounts))
        return null;
    const accounts = [];
    for (const raw of json.accounts.slice(0, 200)) {
        if (!isObject(raw) || !isText(raw.id, 64) || !PLATFORMS.includes(raw.platform) || !isText(raw.token, 4000) || !isText(raw.login, 255))
            return null;
        const parsed = parseInstanceUrl(raw.base);
        if (parsed.error || parsed.base !== raw.base)
            return null;
        accounts.push({id: raw.id, platform: raw.platform, base: raw.base, login: raw.login, token: raw.token});
    }
    const {revision, data} = json.settings;
    if (!Number.isInteger(revision) || revision < 0 || !isObject(data))
        return null;
    return {email: isText(json.user.email, 254) ? json.user.email : '', plan: parsePlan(json.plan), accounts,
        settings: {revision, data}};
}

const MAX_LINE = 2000;
const lines = (value, max) => Array.isArray(value) && value.length > 0 && value.length <= max && value.every(line => isText(line, MAX_LINE));

/** The AI instructions the server hands out, or null: {version, work: {intro, lines}, suggest: {intro, hint, noHint}}. */
export function parsePrompts(json) {
    if (!isObject(json) || !isText(json.version, 64) || !isObject(json.work) || !isObject(json.suggest))
        return null;
    const {work, suggest} = json;
    if (!isText(work.intro, MAX_LINE) || !lines(work.lines, 40) || !lines(suggest.intro, 20) ||
        !isText(suggest.hint, MAX_LINE) || !isText(suggest.noHint, MAX_LINE))
        return null;
    return {version: json.version, work: {intro: work.intro, lines: work.lines},
        suggest: {intro: suggest.intro, hint: suggest.hint, noHint: suggest.noHint}};
}

// What goes where.

/** An account is matched by platform, instance and login, ignoring the login's case. */
export const accountKey = ({platform, base, login}) => `${platform}|${base}|${String(login).toLowerCase()}`;

/**
 * Only accounts signed in with a personal access token travel: a browser sign-in's token is renewed by
 * the device that holds it, and two devices renewing one would sign each other out.
 */
export const isSyncable = account => account.method === 'pat' && Boolean(account.login);

/**
 * Compares this device with the server. `local` are {id, platform, base, login, method} with `token` (null when the
 * keyring can't give it: such an account is still here, so it is never taken for a removed one); `remote`
 * are the server's. `agreed` maps an account key to the fingerprint of its token when both sides last agreed.
 * Returns what to do: pull (add or update here), push (add or update there), removeRemote (removed here since
 * the last sync) and kept (on this device but removed on the server: left alone, not sent again).
 */
export function planAccountSync(local, remote, agreed, fingerprint) {
    const here = new Map(local.filter(isSyncable).map(account => [accountKey(account), account]));
    const there = new Map(remote.map(account => [accountKey(account), account]));
    const plan = {pull: [], push: [], removeRemote: [], kept: []};
    for (const [key, account] of there) {
        const mine = here.get(key);
        if (!mine) {
            if (key in agreed)
                plan.removeRemote.push(account);
            else
                plan.pull.push(account);
            continue;
        }
        // Listed here but its token can't be read (locked or cleared keyring): bring the server's back, never delete.
        if (mine.token === null) {
            plan.pull.push(account);
            continue;
        }
        const same = mine.token === account.token;
        if (same)
            continue;
        const known = agreed[key];
        const localChanged = known !== undefined && fingerprint(mine.token) !== known;
        const remoteChanged = known === undefined || fingerprint(account.token) !== known;
        // Changed only here: send it. Otherwise the server's wins (including when both changed).
        if (localChanged && !remoteChanged)
            plan.push.push(mine);
        else
            plan.pull.push(account);
    }
    for (const [key, account] of here) {
        if (there.has(key))
            continue;
        // Nothing to send without a token.
        if (account.token === null)
            continue;
        if (key in agreed)
            plan.kept.push(account);
        else
            plan.push.push(account);
    }
    return plan;
}

/** The agreed fingerprints after a sync: every syncable account on both sides, by key. */
export function agreedAfterSync(accounts, fingerprint) {
    const agreed = {};
    for (const account of accounts)
        agreed[accountKey(account)] = fingerprint(account.token);
    return agreed;
}

/**
 * The secret to keep in the keyring for a synced account: GitHub keeps the token itself, GitLab a small
 * JSON that says it never needs renewing.
 */
export function secretFor(platform, token) {
    return platform === 'gitlab' ? JSON.stringify({access: token, refresh: null, expiresAt: null}) : token;
}

/** The token out of what the keyring holds (the inverse of secretFor()). */
export function tokenFromSecret(platform, secret) {
    if (typeof secret !== 'string' || !secret)
        return null;
    if (platform !== 'gitlab')
        return secret;
    try {
        const auth = JSON.parse(secret);
        return typeof auth?.access === 'string' && auth.access ? auth.access : null;
    } catch {
        return null;
    }
}

/** The ids a pulled account is stored under. */
export const syncedAccountId = account => accountId(account.platform, account.base, account.login);

// Settings.

/** The settings that follow you: key, and the kind of value (the server checks the same list). */
export const SYNCED_SETTINGS = {
    'group-by': 'string',
    'organization-names': 'map',
    'project-repos': 'map',
    'project-boards': 'list',
    'hidden-boards': 'list',
    repositories: 'list',
    'ai-instructions': 'string',
};

/** `data` reduced to the synced keys with values of the right kind. */
export function cleanSyncedSettings(data) {
    const clean = {};
    for (const [key, kind] of Object.entries(SYNCED_SETTINGS)) {
        const value = data?.[key];
        if (kind === 'string' && typeof value === 'string')
            clean[key] = value;
        else if (kind === 'list' && Array.isArray(value) && value.every(item => typeof item === 'string'))
            clean[key] = value;
        else if (kind === 'map' && isObject(value) && Object.values(value).every(item => typeof item === 'string'))
            clean[key] = value;
    }
    return clean;
}

/** A stable text for `data`, keys sorted, to tell whether it changed. */
export function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (isObject(value))
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

/**
 * What to do with the settings. `remote` is {revision, data}; `lastRevision` and `lastHash` are what this device
 * saw at its last sync; `hash` makes a fingerprint of data. Returns {action: 'none' | 'apply' | 'push', data?, revision?}:
 * apply the server's (it moved on, or both changed: the server's wins), or push ours against `revision`.
 */
export function decideSettings({local, remote, lastRevision, lastHash, hash}) {
    const clean = cleanSyncedSettings(local);
    const localChanged = hash(canonicalJson(clean)) !== lastHash;
    const remoteMoved = remote.revision !== lastRevision;
    if (remoteMoved)
        return {action: 'apply', data: cleanSyncedSettings(remote.data), revision: remote.revision};
    if (localChanged)
        return {action: 'push', data: clean, revision: remote.revision};
    return {action: 'none'};
}

/** The device's name on the server's list of devices. */
export function deviceLabel(hostname) {
    const name = typeof hostname === 'string' && /^[A-Za-z0-9._-]{1,60}$/.test(hostname) ? hostname : 'Computer';
    return `Source Glance on ${name}`;
}

export {GITHUB_COM, GITLAB_COM};
