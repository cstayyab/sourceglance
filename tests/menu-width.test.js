import {test} from 'node:test';
import assert from 'node:assert/strict';

import {MENU_MAX_WIDTH, MENU_MIN_WIDTH, menuWidth} from '../src/lib/model.js';

test('menuWidth takes a share of the screen', () => {
    assert.equal(menuWidth(1600), 448);
    assert.equal(menuWidth(1920), 538);
});

test('menuWidth stays readable on small screens and compact on wide ones', () => {
    assert.equal(menuWidth(1024), MENU_MIN_WIDTH);
    assert.equal(menuWidth(1280), MENU_MIN_WIDTH);
    assert.equal(menuWidth(2560), MENU_MAX_WIDTH);
    assert.equal(menuWidth(5120), MENU_MAX_WIDTH);
});

test('menuWidth scales its limits with the display scaling', () => {
    // A 4K screen at 200 %: the same share as 1920 at 100 %, in physical pixels.
    assert.equal(menuWidth(3840, 2), 1075);
    assert.equal(menuWidth(1920, 2), MENU_MIN_WIDTH * 2);
    assert.equal(menuWidth(7680, 2), MENU_MAX_WIDTH * 2);
    assert.equal(menuWidth(1920, 0), 538);
});
