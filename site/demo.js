// The home page's animated demos: each figure with data-scene plays a short, looping story by
// moving a pointer and switching classes; the CSS does the motion. The workflow tabs play in
// turn until a visitor picks one. With reduced motion, each demo shows its key moment, still.
'use strict';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

class Stop extends Error {}

function stage(figure) {
    let token = 0;
    const $ = name => figure.querySelector(`[data-el="${name}"]`);
    const cursor = $('cursor');
    const api = {
        $,
        token: () => token,
        stop() {
            token++;
        },
        // Waits, unless the scene was stopped meanwhile.
        // With reduced motion, the scene stops at its long pause: the moment worth seeing.
        async wait(ms, mine) {
            if (reduced && ms >= 2500)
                throw new Stop();
            await new Promise(resolve => setTimeout(resolve, reduced ? 0 : ms));
            if (mine !== token)
                throw new Stop();
        },
        async point(target, mine) {
            if (!cursor || reduced)
                return;
            const box = figure.getBoundingClientRect();
            const rect = target.getBoundingClientRect();
            cursor.classList.add('show');
            cursor.style.transform = `translate(${rect.left - box.left + rect.width * 0.55}px, ${rect.top - box.top + rect.height * 0.55}px)`;
            await api.wait(750, mine);
        },
        async click(target, mine) {
            await api.point(target, mine);
            if (cursor && !reduced) {
                cursor.classList.remove('press');
                void cursor.offsetWidth;
                cursor.classList.add('press');
            }
            await api.wait(220, mine);
        },
        hideCursor() {
            cursor?.classList.remove('show');
        },
        async type(target, text, mine) {
            target.textContent = '';
            for (const char of text) {
                target.textContent += char;
                await api.wait(45 + Math.random() * 50, mine);
            }
        },
        async count(target, to, mine) {
            let n = Number(target.textContent);
            while (n !== to) {
                n += n < to ? 1 : -1;
                target.textContent = String(n);
                await api.wait(140, mine);
            }
        },
    };
    return api;
}

const on = (el, cls = 'show') => el.classList.add(cls);
const off = (el, cls = 'show') => el.classList.remove(cls);

// Each scene: reset(s) puts it back to the start; play(s, mine) runs the story once.
const SCENES = {
    topbar: {
        reset({$}) {
            for (const name of ['issues', 'prs', 'boards'])
                $(name).textContent = '0';
            $('gh').textContent = '2';
            off($('menu'));
            off($('sub42'));
            off($('dialog'));
            off($('completed'), 'hover');
            off($('item42'), 'gone');
            off($('item42'), 'hover');
            off($('close42'), 'hover');
            off($('toast'));
            off($('issues-seg'), 'on');
        },
        async play(s, mine) {
            const {$} = s;
            await s.wait(500, mine);
            await Promise.all([s.count($('issues'), 3, mine), s.count($('prs'), 2, mine), s.count($('boards'), 4, mine)]);
            await s.wait(500, mine);
            await s.click($('issues-seg'), mine);
            on($('issues-seg'), 'on');
            on($('menu'));
            await s.wait(500, mine);
            await s.point($('item42'), mine);
            on($('item42'), 'hover');
            on($('sub42'));
            await s.wait(400, mine);
            await s.point($('close42'), mine);
            on($('close42'), 'hover');
            await s.click($('close42'), mine);
            // Close issue… asks how: completed or not planned.
            off($('menu'));
            off($('issues-seg'), 'on');
            on($('dialog'));
            await s.wait(500, mine);
            await s.point($('completed'), mine);
            on($('completed'), 'hover');
            await s.click($('completed'), mine);
            off($('dialog'));
            on($('toast'));
            s.hideCursor();
            // The next refresh drops it from the list.
            await s.wait(700, mine);
            on($('item42'), 'gone');
            off($('sub42'));
            $('gh').textContent = '1';
            await s.count($('issues'), 2, mine);
            await s.wait(2600, mine);
            off($('toast'));
            await s.wait(900, mine);
        },
    },
    triage: {
        reset({$}, figure) {
            off($('pop'));
            off($('check'), 'on');
            off($('lcount'));
            off($('labels'), 'on');
            off($('chips'));
            figure.querySelectorAll('.row').forEach(row => off(row, 'gone'));
        },
        async play(s, mine, figure) {
            const {$} = s;
            await s.wait(700, mine);
            await s.click($('labels'), mine);
            on($('labels'), 'on');
            on($('pop'));
            await s.wait(400, mine);
            await s.click($('check'), mine);
            on($('check'), 'on');
            on($('lcount'));
            on($('chips'));
            for (const row of figure.querySelectorAll('.row.drop')) {
                on(row, 'gone');
                await s.wait(160, mine);
            }
            await s.wait(500, mine);
            off($('pop'));
            off($('labels'), 'on');
            s.hideCursor();
            await s.wait(3200, mine);
        },
    },
    reply: {
        reset({$}) {
            off($('composer'));
            off($('chat'), 'on');
            off($('toast'));
            $('typed').textContent = '';
            $('badge').textContent = '2';
        },
        async play(s, mine) {
            const {$} = s;
            await s.wait(600, mine);
            await s.click($('chat'), mine);
            on($('chat'), 'on');
            on($('composer'));
            s.hideCursor();
            await s.wait(500, mine);
            await s.type($('typed'), 'Fixed in **#51**, can you retest?', mine);
            await s.wait(400, mine);
            await s.click($('post'), mine);
            off($('composer'));
            off($('chat'), 'on');
            on($('toast'));
            s.hideCursor();
            // The list reloads with the new count.
            await s.wait(900, mine);
            $('badge').textContent = '3';
            off($('badge'), 'bump');
            void $('badge').offsetWidth;
            on($('badge'), 'bump');
            await s.wait(3000, mine);
            off($('toast'));
            await s.wait(500, mine);
        },
    },
    read: {
        reset({$}) {
            off($('panel'));
            off($('comment'));
            off($('title').querySelector('.link'), 'hover');
        },
        async play(s, mine) {
            const {$} = s;
            const link = $('title').querySelector('.link');
            await s.wait(600, mine);
            await s.point(link, mine);
            on(link, 'hover');
            await s.click(link, mine);
            on($('panel'));
            s.hideCursor();
            await s.wait(1100, mine);
            on($('comment'));
            await s.wait(3800, mine);
        },
    },
    board: {
        reset({$}) {
            off($('pop'));
            off($('move'), 'on');
            on($('was'), 'on');
            off($('pick'), 'on');
            off($('apply'), 'hover');
            off($('toast'));
            $('status').textContent = 'Team board: In progress';
        },
        async play(s, mine) {
            const {$} = s;
            await s.wait(600, mine);
            await s.click($('move'), mine);
            on($('move'), 'on');
            on($('pop'));
            await s.wait(400, mine);
            await s.click($('pick'), mine);
            off($('was'), 'on');
            on($('pick'), 'on');
            await s.wait(300, mine);
            await s.point($('apply'), mine);
            on($('apply'), 'hover');
            await s.click($('apply'), mine);
            off($('pop'));
            off($('move'), 'on');
            on($('toast'));
            s.hideCursor();
            // The list reloads with the new status.
            await s.wait(900, mine);
            $('status').textContent = 'Team board: Done';
            await s.wait(3000, mine);
            off($('toast'));
            await s.wait(400, mine);
        },
    },
    desk: {
        reset({$}) {
            for (const name of ['w1', 'w2', 'w3'])
                off($(name));
            off($('newpr'));
            $('prs').textContent = '2';
        },
        async play(s, mine) {
            const {$} = s;
            for (const name of ['w1', 'w2', 'w3']) {
                await s.wait(450, mine);
                on($(name));
            }
            await s.wait(1600, mine);
            on($('newpr'));
            $('prs').textContent = '3';
            await s.wait(3500, mine);
        },
    },
};

function setup(figure) {
    const scene = SCENES[figure.dataset.scene];
    const s = stage(figure);
    return {
        // Plays once; resolves false if it was stopped.
        async once() {
            s.stop();
            const mine = s.token();
            scene.reset(s, figure);
            try {
                await scene.play(s, mine, figure);
                return true;
            } catch (e) {
                if (e instanceof Stop)
                    return false;
                throw e;
            }
        },
        stop() {
            s.stop();
            s.hideCursor();
        },
        // Reduced motion: the story up to its key moment, without motion.
        async still() {
            scene.reset(s, figure);
            try {
                await scene.play(s, s.token(), figure);
            } catch {}
        },
    };
}

// The hero loops while it's on screen.
const hero = document.querySelector('.hero [data-scene]');
if (hero) {
    const demo = setup(hero);
    if (reduced) {
        demo.still();
    } else {
        let visible = false;
        let looping = false;
        // One loop at a time; it plays again until the hero scrolls away.
        const loop = async () => {
            if (looping)
                return;
            looping = true;
            try {
                while (visible)
                    await demo.once();
            } finally {
                looping = false;
            }
        };
        new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible)
                loop();
            else
                demo.stop();
        }).observe(hero);
    }
}

// The workflows: tabs, playing in turn until one is picked.
const tabs = [...document.querySelectorAll('.scene-tabs [role="tab"]')];
const tabList = document.querySelector('.scene-tabs');
if (tabs.length) {
    const demos = new Map(tabs.map(tab => {
        const panel = document.getElementById(tab.getAttribute('aria-controls'));
        return [tab, {panel, demo: setup(panel.querySelector('[data-scene]'))}];
    }));
    let current = tabs[0];
    let auto = !reduced;
    let visible = false;
    // The tab whose demo is playing, so scrolling back into view doesn't start a second one.
    let playing = null;

    const run = async () => {
        if (playing?.tab === current)
            return;
        const {demo} = demos.get(current);
        if (reduced) {
            demo.still();
            return;
        }
        const tab = current;
        const me = {tab};
        playing = me;
        tabList.classList.toggle('auto', auto);
        const started = performance.now();
        // A picked tab loops; the tour moves on after one play.
        try {
            while (visible && tab === current) {
                const done = await demo.once();
                if (!done || tab !== current)
                    return;
                if (auto) {
                    tabList.style.setProperty('--scene-ms', `${Math.round(performance.now() - started)}ms`);
                    playing = null;
                    select(tabs[(tabs.indexOf(tab) + 1) % tabs.length]);
                    return;
                }
            }
        } finally {
            if (playing === me)
                playing = null;
        }
    };
    const select = tab => {
        demos.get(current).demo.stop();
        playing = null;
        for (const other of tabs) {
            const selected = other === tab;
            other.setAttribute('aria-selected', String(selected));
            other.tabIndex = selected ? 0 : -1;
            demos.get(other).panel.hidden = !selected;
        }
        current = tab;
        // Restart the fill bar.
        tabList.classList.remove('auto');
        void tabList.offsetWidth;
        run();
    };
    for (const tab of tabs) {
        tab.addEventListener('click', () => {
            auto = false;
            select(tab);
        });
        tab.addEventListener('keydown', event => {
            const step = {ArrowRight: 1, ArrowLeft: -1}[event.key];
            if (!step)
                return;
            const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
            auto = false;
            select(next);
            next.focus();
        });
    }
    new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) {
            run();
        } else {
            demos.get(current).demo.stop();
            playing = null;
        }
    }, {threshold: 0.3}).observe(document.getElementById('in-action'));
}
