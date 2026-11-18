import {test} from 'node:test';
import assert from 'node:assert/strict';

import {RECOMMENDED_WALLPAPER, isRecommendedWallpaper, keepSavedWallpaper, wallpaperChoice} from '../src/lib/model.js';

const mine = {
    'picture-uri': 'file:///home/me/Pictures/hills.jpg',
    'picture-uri-dark': 'file:///home/me/Pictures/hills.jpg',
    'picture-options': 'zoom',
    'primary-color': '#000000',
    'secondary-color': '#000000',
    'color-shading-type': 'solid',
};

test('isRecommendedWallpaper looks at the light and dark pictures', () => {
    assert.ok(isRecommendedWallpaper(RECOMMENDED_WALLPAPER));
    assert.ok(isRecommendedWallpaper({...RECOMMENDED_WALLPAPER, 'picture-options': 'scaled'}));
    assert.ok(!isRecommendedWallpaper({...RECOMMENDED_WALLPAPER, 'picture-uri-dark': mine['picture-uri']}));
    assert.ok(!isRecommendedWallpaper(mine));
    assert.ok(!isRecommendedWallpaper(null));
});

test('wallpaperChoice offers Apply, then Reset, and neither for a wallpaper you set yourself', () => {
    assert.equal(wallpaperChoice(mine, {}), 'apply');
    // Applied: your old wallpaper is kept, so Reset puts it back.
    assert.equal(wallpaperChoice(RECOMMENDED_WALLPAPER, mine), 'reset');
    // Already your wallpaper, not set by Apply: nothing to put back.
    assert.equal(wallpaperChoice(RECOMMENDED_WALLPAPER, {}), 'in-use');
    // Changed some other way after Apply: offer Apply again, not Reset.
    assert.equal(wallpaperChoice(mine, mine), 'apply');
});

test('keepSavedWallpaper drops the copy once the wallpaper changes some other way', () => {
    assert.ok(keepSavedWallpaper(RECOMMENDED_WALLPAPER, mine));
    assert.ok(!keepSavedWallpaper({...mine, 'picture-uri': 'file:///other.png'}, mine));
    assert.ok(!keepSavedWallpaper(RECOMMENDED_WALLPAPER, {}));
});
