// Settings → Project boards to show: every project board of your GitHub accounts, grouped by the
// organization or user that owns it, each with a switch, as in Ubuntu's Limit repositories &
// boards (src/window/pages/accountAccess.js). Hidden boards (the `hidden-boards` setting, by
// address) leave the popovers, the window and the menu-bar counts alike.
import {boardKey, boardOwner, setHiddenBoards} from '@shared/projects.js';

import {element} from './views.js';

export class BoardsList {
    /** `sources()` gives the loaded lists; `names` is a DisplayNames, for the owners' names. */
    constructor({settings, sources, names, section, list}) {
        this._settings = settings;
        this._sources = sources;
        this._names = names;
        this._section = section;
        this._list = list;
        settings.connect(key => {
            if (key === 'hidden-boards')
                this.render();
        });
        names.connectChanged(() => this.render());
    }

    _hidden() {
        return this._settings.get('hidden-boards', []) ?? [];
    }

    _save(keys, hide) {
        this._settings.set('hidden-boards', setHiddenBoards(this._hidden(), keys, hide))
            .catch(e => console.error('sourceglance: saving hidden boards failed', e));
    }

    render() {
        const github = this._sources().filter(src => src.platform === 'github');
        this._section.hidden = github.length === 0;
        const hidden = this._hidden();
        const rows = [];
        for (const src of github) {
            const boards = src.allBoards ?? [];
            if (github.length > 1)
                rows.push(element('li', {className: 'account', text: src.title}));
            if (boards.length === 0) {
                rows.push(element('li', {className: 'empty', text: src.boardsError
                    ? 'Can’t read the project boards of this account. Organization boards need the Source Glance app installed on the organization.'
                    : 'No project boards found'}));
                continue;
            }
            // By owner: the organization or user in the board's address.
            const owners = new Map();
            for (const board of boards) {
                const login = boardOwner(board);
                if (!owners.has(login.toLowerCase()))
                    owners.set(login.toLowerCase(), {login, boards: []});
                owners.get(login.toLowerCase()).boards.push(board);
            }
            for (const {login, boards: ownerBoards} of [...owners.values()].sort((a, b) => a.login.localeCompare(b.login))) {
                const keys = ownerBoards.map(board => boardKey(board));
                const shown = keys.filter(key => !hidden.includes(key)).length;
                const title = login ? this._names.label(src.account, login) : 'Other boards';
                const master = element('input', {attrs: {'type': 'checkbox', 'aria-label': `Show all project boards of ${title}`}});
                master.checked = shown > 0;
                master.addEventListener('change', () => this._save(keys, !master.checked));
                rows.push(element('li', {className: 'organization'}, [
                    element('label', {}, [master, ` ${title}`]),
                    element('span', {className: 'count', text: `${shown}/${keys.length}`}),
                ]));
                for (const board of ownerBoards) {
                    const key = boardKey(board);
                    const box = element('input', {attrs: {'type': 'checkbox', 'aria-label': `Show ${board.title}`}});
                    box.checked = !hidden.includes(key);
                    box.addEventListener('change', () => this._save([key], !box.checked));
                    rows.push(element('li', {className: 'repo'}, [element('label', {}, [box, element('span', {className: 'who'}, [
                        element('span', {text: ` ${board.title}`}),
                        element('small', {text: board.url ? board.url.replace(/^https:\/\//, '') : ''}),
                    ])])]));
                }
            }
        }
        this._list.replaceChildren(...rows);
    }
}
