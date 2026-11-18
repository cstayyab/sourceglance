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
