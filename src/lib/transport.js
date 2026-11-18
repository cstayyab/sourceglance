// Sends HTTP requests for one instance (ADR 0007). github.com, gitlab.com and https://
// instances go through one Soup session. A plain http:// instance is only reached on the local
// network: before every request its name is resolved, every address must be a LAN address
// (accounts.js isLanAddress), and the connection is pinned to that address, so a DNS answer
// that changes in between (DNS rebinding) can't send the token elsewhere.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {allLanAddresses, isIpLiteral, parseInstanceUrl} from './accounts.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.Resolver.prototype, 'lookup_by_name_async');

/** A plain http:// instance that isn't (or is no longer) on the local network. */
export class InsecureHostError extends Error {
    constructor() {
        super('Plain http:// is only used for instances on the local network');
        this.name = 'InsecureHostError';
        this.kind = 'insecure';
    }
}

export class Transport {
    /** `base` is the instance (e.g. https://git.example.com); null for github.com and gitlab.com. */
    constructor(version = 'dev', base = null) {
        this._userAgent = `sourceglance/${version}`;
        const parsed = base ? parseInstanceUrl(base) : null;
        this._selfHosted = Boolean(parsed && !parsed.error);
        this._lan = this._selfHosted && parsed.scheme === 'http' ? parsed : null;
        this._session = this._lan ? null : new Soup.Session({user_agent: this._userAgent, timeout: 30});
        // Pinned sessions of a LAN instance, by address.
        this._pinned = new Map();
    }

    destroy() {
        this._destroyed = true;
        this._session?.abort();
        this._session = null;
        for (const session of this._pinned.values())
            session.abort();
        this._pinned.clear();
    }

    /** Sends `message`; resolves to the body's GLib.Bytes (the status is on the message). */
    async send(message, cancellable = null) {
        // Self-hosted: never follow a redirect, which could lead the token to another host.
        if (this._selfHosted)
            message.add_flags(Soup.MessageFlags.NO_REDIRECT);
        const session = this._destroyed ? null : this._lan ? await this._lanSession(cancellable) : this._session;
        if (!session || this._destroyed)
            throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Operation was cancelled');
        return session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
    }

    /** A session that connects only to a checked LAN address of the instance. */
    async _lanSession(cancellable) {
        const {hostname, port} = this._lan;
        let addresses;
        if (isIpLiteral(hostname)) {
            addresses = [hostname];
        } else {
            const found = await Gio.Resolver.get_default().lookup_by_name_async(hostname, cancellable);
            addresses = found.map(address => address.to_string());
        }
        if (!allLanAddresses(addresses))
            throw new InsecureHostError();
        // All of them are checked; connect to one, IPv4 first, as LAN servers often listen only there.
        const address = addresses.find(found => !found.includes(':')) ?? addresses[0];
        let session = this._pinned.get(address);
        if (!session) {
            session = new Soup.Session({
                user_agent: this._userAgent,
                timeout: 30,
                remote_connectable: new Gio.InetSocketAddress({
                    address: Gio.InetAddress.new_from_string(address.replace(/%.*$/, '')),
                    port,
                }),
            });
            this._pinned.set(address, session);
        }
        return session;
    }
}
