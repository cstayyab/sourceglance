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
