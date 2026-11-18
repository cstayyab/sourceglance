// Formatting for the comment editor's toolbar: Markdown marks applied to a selection. Pure (no
// GNOME imports). Offsets count characters (code points), as Gtk.TextBuffer's do.

/** The toolbar's formats, in order. Inline ones wrap the selection; the rest prefix its lines. */
export const FORMATS = {
    bold: {wrap: ['**', '**']},
    italic: {wrap: ['_', '_']},
    strike: {wrap: ['~~', '~~']},
    code: {wrap: ['`', '`']},
    codeBlock: {wrap: ['```\n', '\n```'], block: true},
    bullet: {prefix: () => '- '},
    number: {prefix: i => `${i + 1}. `},
    quote: {prefix: () => '> '},
};

const LINE_PREFIX = {
    bullet: /^- /,
    number: /^\d+\. /,
    quote: /^> ?/,
};

/**
 * Applies `format` to text[start, end). Returns {text, start, end}: the new text and the
 * selection to show. Applying the same format again takes it off.
 */
export function applyFormat(text, start, end, format) {
    const spec = FORMATS[format];
    if (!spec)
        throw new TypeError(`sourceglance: unknown format ${format}`);
    const chars = [...text];
    [start, end] = [Math.max(0, Math.min(start, end)), Math.min(chars.length, Math.max(start, end))];
    return spec.wrap ? wrap(chars, start, end, spec) : prefixLines(chars, start, end, format);
}

function wrap(chars, start, end, {wrap: [open, close], block}) {
    const before = chars.slice(0, start).join('');
    const selected = chars.slice(start, end).join('');
    const after = chars.slice(end).join('');
    const openLength = [...open].length;
    const closeLength = [...close].length;
    // Already wrapped, inside or just outside the selection: unwrap.
    if (selected.length >= open.length + close.length && selected.startsWith(open) && selected.endsWith(close)) {
        const inner = [...selected].slice(openLength, -closeLength).join('');
        return {text: before + inner + after, start, end: start + [...inner].length};
    }
    if (before.endsWith(open) && after.startsWith(close)) {
        const outer = [...before].slice(0, -openLength).join('');
        return {
            text: outer + selected + after.slice(close.length),
            start: start - openLength,
            end: end - openLength,
        };
    }
    // A block starts and ends on lines of its own.
    const lead = block && before.length > 0 && !before.endsWith('\n') ? '\n' : '';
    const trail = block && after.length > 0 && !after.startsWith('\n') ? '\n' : '';
    const from = start + [...lead].length + openLength;
    return {
        text: before + lead + open + selected + close + trail + after,
        start: from,
        end: from + (end - start),
    };
}

function prefixLines(chars, start, end, format) {
    // Widen to whole lines.
    let from = start;
    while (from > 0 && chars[from - 1] !== '\n')
        from--;
    let to = end;
    while (to < chars.length && chars[to] !== '\n')
        to++;
    const lines = chars.slice(from, to).join('').split('\n');
    const pattern = LINE_PREFIX[format];
    const content = lines.filter(line => line.trim().length > 0);
    const remove = content.length > 0 && content.every(line => pattern.test(line));
    let n = 0;
    const changed = lines.map(line => {
        if (remove)
            return line.replace(pattern, '');
        if (line.trim().length === 0 && lines.length > 1)
            return line;
        return FORMATS[format].prefix(n++) + line.replace(/^(- |\d+\. |> ?)/, '');
    });
    const replaced = changed.join('\n');
    const head = chars.slice(0, from).join('');
    const tail = chars.slice(to).join('');
    return {text: head + replaced + tail, start: from, end: from + [...replaced].length};
}

// Rendering: GitHub and GitLab Markdown as blocks of Pango markup, for the preview. Only what's
// built here becomes markup: every bit of the source text is escaped first, and links are
// kept only when they're http(s) (threat model T6).

/** Escapes text for Pango markup. */
export function escapeMarkup(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const WEB_LINK = /^https?:\/\/[^\s<>"']+$/i;

const INLINE = new RegExp([
    '(?<tick>`+)(?<code>[\\s\\S]*?[^`])\\k<tick>(?!`)',
    '!\\[(?<alt>[^\\]]*)\\]\\((?<src>[^)\\s]+)(?:\\s+"[^"]*")?\\)',
    '\\[(?<text>[^\\]]+)\\]\\((?<href>[^)\\s]+)(?:\\s+"[^"]*")?\\)',
    '\\*\\*(?=\\S)(?<bold>[\\s\\S]*?\\S)\\*\\*',
    '(?<![\\w])__(?=\\S)(?<bold2>[\\s\\S]*?\\S)__(?![\\w])',
    '~~(?=\\S)(?<strike>[\\s\\S]*?\\S)~~',
    '\\*(?=[^\\s*])(?<em>[\\s\\S]*?[^\\s*])\\*',
    '(?<![\\w])_(?=[^\\s_])(?<em2>[\\s\\S]*?[^\\s_])_(?![\\w])',
    '<(?<auto>https?:\\/\\/[^>\\s]+)>',
    '(?<bare>https?:\\/\\/[^\\s<>()]*[^\\s<>().,;:!?\'"*_~])',
    '(?<br><br\\s*\\/?>)',
    '(?<tag><\\/?[a-zA-Z][^<>]*>)',
].join('|'), 'g');

function link(href, inner) {
    return WEB_LINK.test(href) ? `<a href="${escapeMarkup(href)}">${inner}</a>` : inner;
}

/**
 * One line or paragraph of Markdown as Pango markup: bold, italic, strikethrough, code and
 * links. HTML tags are dropped (<br> is a line break). `links` false keeps link text only.
 */
export function inlineMarkup(text, links = true) {
    let out = '';
    let last = 0;
    const re = new RegExp(INLINE.source, 'g');
    for (let m = re.exec(text); m; m = re.exec(text)) {
        out += escapeMarkup(text.slice(last, m.index));
        last = m.index + m[0].length;
        const g = m.groups;
        if (g.code !== undefined)
            out += `<tt>${escapeMarkup(g.code.trim() || g.code)}</tt>`;
        else if (g.src !== undefined)
            out += links ? link(g.src, escapeMarkup(g.alt || 'image')) : escapeMarkup(g.alt);
        else if (g.href !== undefined)
            out += links ? link(g.href, inlineMarkup(g.text, false)) : inlineMarkup(g.text, false);
        else if (g.bold !== undefined || g.bold2 !== undefined)
            out += `<b>${inlineMarkup(g.bold ?? g.bold2, links)}</b>`;
        else if (g.strike !== undefined)
            out += `<s>${inlineMarkup(g.strike, links)}</s>`;
        else if (g.em !== undefined || g.em2 !== undefined)
            out += `<i>${inlineMarkup(g.em ?? g.em2, links)}</i>`;
        else if (g.auto !== undefined || g.bare !== undefined)
            out += links ? link(g.auto ?? g.bare, escapeMarkup(g.auto ?? g.bare)) : escapeMarkup(g.auto ?? g.bare);
        else if (g.br !== undefined)
            out += '\n';
        // Other HTML tags: dropped, their text stays.
    }
    return out + escapeMarkup(text.slice(last));
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function tableCells(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

/**
 * Markdown as blocks, each with its text still Markdown (see inlineMarkup()):
 * {type: 'heading', level, text}, {type: 'paragraph', text}, {type: 'code', text},
 * {type: 'rule'}, {type: 'quote', blocks}, {type: 'table', rows} (the first is the header) and
 * {type: 'list', items: [{text, depth, marker}]}, where marker is '•', '1.', '☐' or '☑'.
 * HTML comments are dropped.
 */
export function markdownBlocks(source) {
    const lines = source.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?(?:-->|$)/g, '').split('\n');
    const blocks = [];
    let paragraph = [];
    const flush = () => {
        if (paragraph.length)
            blocks.push({type: 'paragraph', text: paragraph.join('\n')});
        paragraph = [];
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fence = line.match(FENCE);
        if (fence) {
            flush();
            const code = [];
            for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++)
                code.push(lines[i]);
            blocks.push({type: 'code', text: code.join('\n')});
            continue;
        }
        if (!line.trim()) {
            flush();
            continue;
        }
        const heading = line.match(HEADING);
        if (heading) {
            flush();
            blocks.push({type: 'heading', level: heading[1].length, text: heading[2]});
            continue;
        }
        if (RULE.test(line)) {
            flush();
            blocks.push({type: 'rule'});
            continue;
        }
        if (QUOTE.test(line)) {
            flush();
            const quoted = [];
            for (; i < lines.length && QUOTE.test(lines[i]); i++)
                quoted.push(lines[i].match(QUOTE)[1]);
            i--;
            blocks.push({type: 'quote', blocks: markdownBlocks(quoted.join('\n'))});
            continue;
        }
        if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
            flush();
            const rows = [tableCells(line)];
            for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i++)
                rows.push(tableCells(lines[i]));
            i--;
            blocks.push({type: 'table', rows});
            continue;
        }
        if (ITEM.test(line)) {
            flush();
            const items = [];
            for (; i < lines.length && lines[i].trim(); i++) {
                const item = lines[i].match(ITEM);
                if (!item) {
                    // A continuation line belongs to the item above.
                    items.at(-1).text += `\n${lines[i].trim()}`;
                    continue;
                }
                let [, indent, marker, text] = item;
                const task = text.match(/^\[([ xX])\]\s+(.*)$/);
                if (task)
                    [marker, text] = [task[1] === ' ' ? '☐' : '☑', task[2]];
                else
                    marker = /\d/.test(marker) ? `${parseInt(marker)}.` : '•';
                items.push({text, depth: Math.floor(indent.replace(/\t/g, '    ').length / 2), marker});
            }
            i--;
            blocks.push({type: 'list', items});
            continue;
        }
        paragraph.push(line);
    }
    flush();
    return blocks;
}
