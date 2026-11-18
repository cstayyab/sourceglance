// Translations for the window. It runs in its own app (launcher.js) as well as in GNOME's
// Extensions app (prefs.js), so it uses the extension's gettext domain, its UUID, directly
// instead of GNOME's per-extension gettext, which only works inside the Extensions app.
import Gettext from 'gettext';

const domain = Gettext.domain('sourceglance@omer-gh.github.io');

export const gettext = domain.gettext;
export const ngettext = domain.ngettext;
