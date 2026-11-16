// GitHub token storage in the GNOME keyring (ADR 0002). Never log the token.
import Secret from 'gi://Secret';

const ATTRIBUTES = {account: 'github.com'};
let schema = null;

function getSchema() {
    schema ??= new Secret.Schema('io.github.omer-gh.sourceglance', Secret.SchemaFlags.NONE, {
        account: Secret.SchemaAttributeType.STRING,
    });
    return schema;
}

/** Resolves to the stored token, or null if there is none. */
export function lookupToken(cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_lookup(getSchema(), ATTRIBUTES, cancellable, (_source, result) => {
            try {
                resolve(Secret.password_lookup_finish(result) || null);
            } catch (e) {
                reject(e);
            }
        });
    });
}

export function storeToken(token, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_store(getSchema(), ATTRIBUTES, Secret.COLLECTION_DEFAULT,
            'sourceglance GitHub token', token, cancellable, (_source, result) => {
                try {
                    resolve(Secret.password_store_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

export function clearToken(cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_clear(getSchema(), ATTRIBUTES, cancellable, (_source, result) => {
            try {
                resolve(Secret.password_clear_finish(result));
            } catch (e) {
                reject(e);
            }
        });
    });
}
