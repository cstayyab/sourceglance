// A page that isn't built yet: an icon, a title and what it will do.
import Adw from 'gi://Adw';

export function buildPlaceholderPage({iconName, title, description}) {
    return new Adw.StatusPage({icon_name: iconName, title, description});
}
