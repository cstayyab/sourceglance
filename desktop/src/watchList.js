// Settings → Repositories to watch: which github.com repositories the lists show (the `repositories`
// setting; empty means all). The same rules as the watch list in Ubuntu's Limit repositories &
// boards (src/shared/repoAccess.js): switching one off from "all" lists the rest, listing everything
// goes back to empty, the last one can't be switched off, and adding keeps what's watched.
import {GITHUB_COM} from '@shared/accounts.js';
import {isValidRepo} from '@shared/model.js';
import {
    MAX_PAGES,
    addWatched,
    availableRepos,
    isWatched,
    mayHaveMore,
    parseRepos,
    parseSearchRepos,
    reposByOrganization,
    reposRequest,
    searchReposRequest,
    setWatched,
    toggleWatched,
} from '@shared/repoAccess.js';

import {element} from './views.js';

export class WatchList {
    /** `accounts()` lists the accounts, `seenRepos()` the repositories seen on items. */
    constructor({settings, clients, accounts, seenRepos, section, list, search, results}) {
        this._settings = settings;
        this._clients = clients;
        this._accounts = accounts;
        this._seenRepos = seenRepos;
        this._section = section;
        this._list = list;
        this._search = search;
        this._results = results;
        // The repositories each github.com sign-in can see, asked once per account this session.
        this._available = new Map();
        this._query = 0;
        this._timer = null;

        search.addEventListener('input', () => this._searchSoon());
        search.addEventListener('keydown', event => {
            if (event.key !== 'Enter')
                return;
            event.preventDefault();
            // A full owner/name adds it without searching.
            const name = search.value.trim();
            if (isValidRepo(name)) {
                this._add(name);
                search.value = '';
                results.replaceChildren();
            }
        });
        settings.connect(key => {
            if (key === 'repositories')
                this.render();
        });
    }

    _githubAccounts() {
        return this._accounts().filter(account => account.platform === 'github' && account.base === GITHUB_COM);
    }

    _watched() {
        return this._settings.get('repositories', []) ?? [];
    }

    async _all() {
        const seen = this._seenRepos().filter(repo => isValidRepo(repo));
        const known = await Promise.all(this._githubAccounts().map(account => this._repos(account)));
        return availableRepos(known.flat(), [...seen, ...this._watched()]);
    }

    // Up to three pages of the repositories a sign-in can see (read-only).
    _repos(account) {
        if (!this._available.has(account.id)) {
            this._available.set(account.id, (async () => {
                const found = [];
                try {
                    const token = await this._clients.tokenFor(account);
                    if (!token)
                        return found;
                    const client = this._clients.clientFor(account);
                    for (let page = 1; page <= MAX_PAGES; page++) {
                        const json = await client.send(token, reposRequest(page));
                        found.push(...parseRepos(json));
                        if (!mayHaveMore(json))
                            break;
                    }
                } catch {
                    // The repositories seen on items still show.
                }
                return found;
            })());
        }
        return this._available.get(account.id);
    }

    async _set(next) {
        try {
            await this._settings.set('repositories', next);
        } catch (e) {
            console.error('sourceglance: saving the watch list failed', e);
        }
    }

    async _add(name) {
        await this._set(addWatched(this._watched(), await this._all(), [name]));
    }

    // Searches public repositories 0.4 s after the last key, from two characters. An older answer
    // never replaces a newer one.
    _searchSoon() {
        clearTimeout(this._timer);
        const query = this._search.value.trim();
        const mine = ++this._query;
        if (query.length < 2) {
            this._results.replaceChildren();
            return;
        }
        this._timer = setTimeout(async () => {
            const account = this._githubAccounts()[0];
            if (!account)
                return;
            let found = [];
            try {
                const token = await this._clients.tokenFor(account);
                if (token)
                    found = parseSearchRepos(await this._clients.clientFor(account).send(token, searchReposRequest(query)));
            } catch {
                found = [];
            }
            if (mine !== this._query)
                return;
            const watched = this._watched();
            this._results.replaceChildren(...found.map(repo => {
                const on = watched.some(name => name.toLowerCase() === repo.name.toLowerCase());
                const add = element('button', {text: on ? 'Watched' : 'Add', attrs: {type: 'button'}});
                add.disabled = on;
                add.addEventListener('click', () => this._add(repo.name));
                return element('li', {}, [
                    element('span', {className: 'who'}, [element('span', {text: repo.name}),
                        element('small', {text: repo.description || `${repo.stars} stars`})]),
                    add,
                ]);
            }));
        }, 400);
    }

    /** Draws the list, grouped by organization, each with a switch for all its repositories. */
    async render() {
        const accounts = this._githubAccounts();
        this._section.hidden = accounts.length === 0;
        if (accounts.length === 0)
            return;
        const all = await this._all();
        const watched = this._watched();
        const rows = [];
        for (const {organization, repos} of reposByOrganization(all)) {
            const on = repos.filter(repo => isWatched(watched, repo)).length;
            const master = element('input', {attrs: {'type': 'checkbox', 'aria-label': `Watch every repository of ${organization}`}});
            master.checked = on === repos.length;
            master.indeterminate = on > 0 && on < repos.length;
            master.addEventListener('change', () => this._set(setWatched(watched, all, repos, master.checked)));
            rows.push(element('li', {className: 'organization'}, [element('label', {}, [master, ` ${organization}`])]));
            for (const repo of repos) {
                const box = element('input', {attrs: {'type': 'checkbox', 'aria-label': `Watch ${repo}`}});
                box.checked = isWatched(watched, repo);
                box.addEventListener('change', async () => {
                    const next = toggleWatched(watched, all, repo, box.checked);
                    // The last watched repository can't be switched off (an empty list means all).
                    if (next === watched)
                        box.checked = true;
                    else
                        await this._set(next);
                });
                rows.push(element('li', {className: 'repo'}, [element('label', {}, [box, ` ${repo}`])]));
            }
        }
        if (rows.length === 0)
            rows.push(element('li', {className: 'empty', text: 'No repositories found yet.'}));
        this._list.replaceChildren(...rows);
    }
}
