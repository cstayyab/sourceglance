// The wallpaper Glance → Desktop Widgets recommends (RECOMMENDED_WALLPAPER in model.js).
// Apply keeps a copy of your wallpaper in saved-wallpaper, and Reset puts it back. The
// extension drops that copy when the wallpaper changes any other way, so Reset is only
// offered while the recommended wallpaper Apply set is still there. No Shell imports: the
// window uses this too.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {RECOMMENDED_WALLPAPER, WALLPAPER_KEYS, isRecommendedWallpaper, keepSavedWallpaper} from './model.js';

export function backgroundSettings() {
    return new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
}

/** Whether the recommended wallpaper's files are installed (gnome-backgrounds). */
export function recommendedWallpaperInstalled() {
    return ['picture-uri', 'picture-uri-dark'].every(key =>
        Gio.File.new_for_uri(RECOMMENDED_WALLPAPER[key]).query_exists(null));
}

/** The wallpaper set now: {key: value} of WALLPAPER_KEYS. */
export function currentWallpaper(background) {
    return Object.fromEntries(WALLPAPER_KEYS.map(key => [key, background.get_string(key)]));
}

/** Apply's copy of the wallpaper it replaced; {} if there's none. */
export function savedWallpaper(settings) {
    return settings.get_value('saved-wallpaper').deepUnpack();
}

// All at once, so nothing watching the wallpaper sees it half changed.
function setWallpaper(background, values) {
    background.delay();
    for (const key of WALLPAPER_KEYS) {
        if (typeof values[key] === 'string')
            background.set_string(key, values[key]);
    }
    background.apply();
}

/** Sets the recommended wallpaper, keeping a copy of yours first. */
export function applyRecommendedWallpaper(background, settings) {
    const current = currentWallpaper(background);
    if (isRecommendedWallpaper(current))
        return;
    settings.set_value('saved-wallpaper', new GLib.Variant('a{ss}', current));
    setWallpaper(background, RECOMMENDED_WALLPAPER);
}

/** Puts back the wallpaper Apply replaced. */
export function restoreSavedWallpaper(background, settings) {
    const saved = savedWallpaper(settings);
    settings.reset('saved-wallpaper');
    if (Object.keys(saved).length)
        setWallpaper(background, saved);
}

/** Forgets Apply's copy once the recommended wallpaper is no longer set. */
export function forgetStaleSavedWallpaper(background, settings) {
    const saved = savedWallpaper(settings);
    if (Object.keys(saved).length && !keepSavedWallpaper(currentWallpaper(background), saved))
        settings.reset('saved-wallpaper');
}
