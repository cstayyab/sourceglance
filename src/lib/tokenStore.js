// Sign-in storage in the GNOME keyring (ADR 0002): one entry per account, under the same
// schema. GitHub keeps a token; GitLab keeps JSON {access, refresh, expiresAt}. Never log them.
import Secret from 'gi://Secret';

export const GITHUB_ACCOUNT = 'github.com';
export const GITLAB_ACCOUNT = 'gitlab.com';
const LABELS = {[GITHUB_ACCOUNT]: 'Source Glance GitHub token', [GITLAB_ACCOUNT]: 'Source Glance GitLab sign-in'};
let schema = null;

function getSchema() {
    schema ??= new Secret.Schema('io.github.omer-gh.sourceglance', Secret.SchemaFlags.NONE, {
        account: Secret.SchemaAttributeType.STRING,
    });
    return schema;
}

/** Resolves to the stored secret for `account`, or null if there is none. */
export function lookupSecret(account, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_lookup(getSchema(), {account}, cancellable, (_source, result) => {
            try {
                resolve(Secret.password_lookup_finish(result) || null);
            } catch (e) {
                reject(e);
            }
        });
    });
}

export function storeSecret(account, secret, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_store(getSchema(), {account}, Secret.COLLECTION_DEFAULT,
            LABELS[account] ?? `Source Glance ${account}`, secret, cancellable, (_source, result) => {
                try {
                    resolve(Secret.password_store_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

export function clearSecret(account, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_clear(getSchema(), {account}, cancellable, (_source, result) => {
            try {
                resolve(Secret.password_clear_finish(result));
            } catch (e) {
                reject(e);
            }
        });
    });
}

// GitHub, as before.
export const lookupToken = (cancellable = null) => lookupSecret(GITHUB_ACCOUNT, cancellable);
export const storeToken = (token, cancellable = null) => storeSecret(GITHUB_ACCOUNT, token, cancellable);
export const clearToken = (cancellable = null) => clearSecret(GITHUB_ACCOUNT, cancellable);
