// Glance → Desktop Widgets: which cards show on the desktop, and how.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {RECOMMENDED_WALLPAPER, normalizeWidgets, wallpaperChoice} from '../../lib/model.js';
import {applyRecommendedWallpaper, backgroundSettings, currentWallpaper, recommendedWallpaperInstalled,
    restoreSavedWallpaper, savedWallpaper} from '../../lib/wallpaper.js';

// Where the recommended wallpaper comes from, credited under its preview.
const WALLPAPER_SOURCE_URL = 'https://gitlab.gnome.org/GNOME/gnome-backgrounds';
const PREVIEW_WIDTH = 480;

/** Shows the wallpaper scaled down, loaded off the main thread (the files are several MB). */
function loadPreview(picture, uri) {
    const file = Gio.File.new_for_uri(uri);
    file.read_async(GLib.PRIORITY_DEFAULT, null, (_file, readResult) => {
        try {
            const stream = file.read_finish(readResult);
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, PREVIEW_WIDTH, -1, true, null, (_stream, result) => {
                try {
                    picture.paintable = Gdk.Texture.new_for_pixbuf(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
                } catch (e) {
                    console.debug(`sourceglance: no wallpaper preview: ${e.message}`);
                }
            });
        } catch (e) {
            console.debug(`sourceglance: no wallpaper preview: ${e.message}`);
        }
    });
}

/**
 * The recommended wallpaper: a preview, where it's from, and Apply (keeping yours) or Reset
 * (putting yours back). Reset is only offered until the wallpaper changes some other way.
 */
function buildWallpaperGroup({window, settings, toast}) {
    const group = new Adw.PreferencesGroup({
        title: _('Wallpaper'),
        description: _('The cards are made to sit on Adwaita, GNOME’s default wallpaper. Set it to go with them; you can put yours back later.'),
    });

    const picture = new Gtk.Picture({content_fit: Gtk.ContentFit.COVER, height_request: 200,
        css_classes: ['sourceglance-wallpaper-preview'], overflow: Gtk.Overflow.HIDDEN,
        alternative_text: _('Preview of the Adwaita wallpaper')});
    group.add(picture);
    const style = Adw.StyleManager.get_default();
    const showPreview = () => loadPreview(picture,
        RECOMMENDED_WALLPAPER[style.dark ? 'picture-uri-dark' : 'picture-uri']);
    const darkId = style.connect('notify::dark', showPreview);
    showPreview();

    const row = new Adw.ActionRow({title: _('Adwaita')});
    const source = new Gtk.LinkButton({uri: WALLPAPER_SOURCE_URL, label: _('From GNOME Backgrounds'),
        valign: Gtk.Align.CENTER, css_classes: ['flat']});
    const button = new Gtk.Button({valign: Gtk.Align.CENTER});
    const inUse = new Gtk.Image({icon_name: 'object-select-symbolic', valign: Gtk.Align.CENTER,
        tooltip_text: _('This is your wallpaper')});
    row.add_suffix(source);
    row.add_suffix(button);
    row.add_suffix(inUse);
    group.add(row);

    const background = backgroundSettings();
    const update = () => {
        const choice = wallpaperChoice(currentWallpaper(background), savedWallpaper(settings));
        button.visible = choice !== 'in-use';
        inUse.visible = choice === 'in-use';
        if (choice === 'apply') {
            row.subtitle = _('Set it as your wallpaper. Source Glance keeps yours to put back.');
            button.label = _('Apply');
            button.css_classes = ['suggested-action'];
        } else if (choice === 'reset') {
            row.subtitle = _('Your wallpaper now. Reset puts your previous one back.');
            button.label = _('Reset');
            button.css_classes = [];
        } else {
            row.subtitle = _('Already your wallpaper');
        }
    };
    button.connect('clicked', () => {
        if (wallpaperChoice(currentWallpaper(background), savedWallpaper(settings)) === 'apply') {
            applyRecommendedWallpaper(background, settings);
            toast(_('Wallpaper set to Adwaita'));
        } else {
            restoreSavedWallpaper(background, settings);
            toast(_('Your wallpaper is back'));
        }
    });
    const backgroundId = background.connect('changed', update);
    const savedId = settings.connect('changed::saved-wallpaper', update);
    update();

    window.connect('close-request', () => {
        style.disconnect(darkId);
        background.disconnect(backgroundId);
        settings.disconnect(savedId);
        return false;
    });
    return group;
}

/** `ctx` is {window, settings, toast}. Adds its groups to `page` (a new one by default) and returns it. */
export function buildWidgetsPage({window, settings, toast}, page = new Adw.PreferencesPage()) {
    const cards = new Adw.PreferencesGroup({
        title: _('Cards on the desktop'),
        description: _('Cards sit on the desktop, below your windows. Drag a card by its header to move it.'),
    });
    page.add(cards);
    for (const [id, title, subtitle] of [
        ['summary', _('Summary'), _('All counts, including closed and merged items still assigned to you')],
        ['issues', _('Issues'), _('Open issues assigned to you')],
        ['prs', _('Pull requests'), _('Assigned to you or awaiting your review')],
        ['projects', _('Projects'), _('Draft items on your project boards')],
    ]) {
        const row = new Adw.SwitchRow({
            title,
            subtitle,
            active: normalizeWidgets(settings.get_strv('widgets')).includes(id),
        });
        row.connect('notify::active', () => {
            const current = normalizeWidgets(settings.get_strv('widgets'));
            const next = row.active ? [...current, id] : current.filter(other => other !== id);
            settings.set_strv('widgets', normalizeWidgets(next));
        });
        cards.add(row);
    }

    const look = new Adw.PreferencesGroup({title: _('Appearance')});
    page.add(look);
    const opacity = new Adw.SpinRow({
        title: _('Opacity'),
        subtitle: _('Percent'),
        adjustment: new Gtk.Adjustment({lower: 30, upper: 100, step_increment: 5}),
    });
    settings.bind('widget-opacity', opacity, 'value', Gio.SettingsBindFlags.DEFAULT);
    look.add(opacity);

    const reset = new Adw.ActionRow({title: _('Reset positions'), subtitle: _('Put every card back in the column on the right')});
    const resetButton = new Gtk.Button({label: _('Reset'), valign: Gtk.Align.CENTER});
    resetButton.connect('clicked', () => {
        settings.reset('widget-positions');
        toast(_('Cards moved back'));
    });
    reset.add_suffix(resetButton);
    look.add(reset);

    if (recommendedWallpaperInstalled())
        page.add(buildWallpaperGroup({window, settings, toast}));
    return page;
}
