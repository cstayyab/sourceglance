import {test} from 'node:test';
import assert from 'node:assert/strict';

import {applyFormat} from '../src/lib/markdown.js';

test('inline formats wrap the selection and toggle off again', () => {
    const bold = applyFormat('say hello now', 4, 9, 'bold');
    assert.deepEqual(bold, {text: 'say **hello** now', start: 6, end: 11});
    assert.deepEqual(applyFormat(bold.text, bold.start, bold.end, 'bold'), {text: 'say hello now', start: 4, end: 9});
    // Selecting the marks too also takes them off.
    assert.equal(applyFormat('say **hello** now', 4, 13, 'bold').text, 'say hello now');
    assert.deepEqual(applyFormat('a b', 1, 1, 'italic'), {text: 'a__ b', start: 2, end: 2});
    assert.equal(applyFormat('x', 0, 1, 'strike').text, '~~x~~');
    assert.equal(applyFormat('x', 0, 1, 'code').text, '`x`');
});

test('offsets count characters, not UTF-16 units', () => {
    assert.deepEqual(applyFormat('😀 hi', 2, 4, 'bold'), {text: '😀 **hi**', start: 4, end: 6});
});

test('a code block sits on lines of its own', () => {
    assert.deepEqual(applyFormat('run ls now', 4, 6, 'codeBlock'),
        {text: 'run \n```\nls\n```\n now', start: 9, end: 11});
    assert.equal(applyFormat('ls', 0, 2, 'codeBlock').text, '```\nls\n```');
});

test('list and quote formats prefix whole lines and toggle off', () => {
    const text = 'one\ntwo\n\nthree';
    const bullets = applyFormat(text, 1, 14, 'bullet');
    assert.equal(bullets.text, '- one\n- two\n\n- three');
    assert.equal(applyFormat(bullets.text, 0, bullets.text.length, 'bullet').text, text);
    assert.equal(applyFormat(text, 0, 7, 'number').text, '1. one\n2. two\n\nthree');
    // Switching kinds replaces the old prefix.
    assert.equal(applyFormat('- one', 0, 0, 'quote').text, '> one');
    assert.deepEqual(applyFormat('', 0, 0, 'bullet'), {text: '- ', start: 0, end: 2});
    assert.throws(() => applyFormat('x', 0, 1, 'underline'), TypeError);
});

import {escapeMarkup, inlineMarkup, markdownBlocks} from '../src/lib/markdown.js';

test('inline Markdown becomes Pango markup, with the source escaped', () => {
    assert.equal(inlineMarkup('**bold** _it_ ~~gone~~ `a<b>`'), '<b>bold</b> <i>it</i> <s>gone</s> <tt>a&lt;b&gt;</tt>');
    assert.equal(inlineMarkup('a < b & "c"'), 'a &lt; b &amp; &quot;c&quot;');
    assert.equal(inlineMarkup('snake_case_name'), 'snake_case_name');
    assert.equal(inlineMarkup('see [docs](https://x.io/a?b=1&c=2)'), 'see <a href="https://x.io/a?b=1&amp;c=2">docs</a>');
    assert.equal(inlineMarkup('go https://x.io/a.'), 'go <a href="https://x.io/a">https://x.io/a</a>.');
});

test('only web links become links; HTML is dropped', () => {
    // Not a web link: only its text stays.
    assert.equal(inlineMarkup('[x](javascript:alert(1))'), 'x)');
    assert.equal(inlineMarkup('[x](/relative)'), 'x');
    assert.equal(inlineMarkup('<img src="a"> hi<br>there <b onclick="x">b</b>'), ' hi\nthere b');
    assert.equal(inlineMarkup('[a https://x.io](https://y.io)'), '<a href="https://y.io">a https://x.io</a>');
    assert.equal(escapeMarkup('<a href=\'x\'>'), '&lt;a href=&#39;x&#39;&gt;');
});

test('Markdown splits into blocks', () => {
    const blocks = markdownBlocks([
        '# Title', 'line one', 'line two', '', '- [ ] todo', '  - [x] done', '1. first', '',
        '> quoted', '```js', '<b>code</b>', '```', '---', '| a | b |', '|---|---|', '| 1 | 2 |', '<!-- hidden -->',
    ].join('\n'));
    assert.deepEqual(blocks, [
        {type: 'heading', level: 1, text: 'Title'},
        {type: 'paragraph', text: 'line one\nline two'},
        {type: 'list', items: [{text: 'todo', depth: 0, marker: '☐'}, {text: 'done', depth: 1, marker: '☑'},
            {text: 'first', depth: 0, marker: '1.'}]},
        {type: 'quote', blocks: [{type: 'paragraph', text: 'quoted'}]},
        {type: 'code', text: '<b>code</b>'},
        {type: 'rule'},
        {type: 'table', rows: [['a', 'b'], ['1', '2']]},
    ]);
});
