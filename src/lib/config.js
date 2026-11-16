// Build-time configuration. Client IDs are public by design: device flow needs no client
// secret. See docs/development.md for registering the apps.

// The sourceglance GitHub App: the default "Sign in with GitHub". Its permissions are fixed
// to Issues, Pull requests and Projects (read and write) plus read-only Metadata, and it
// only sees the repositories it is installed on. No code, settings or admin access.
// While empty, the default sign-in is unavailable.
export const GITHUB_APP_CLIENT_ID = '';
// The app's URL name, from https://github.com/apps/<slug>, for "Choose repositories".
export const GITHUB_APP_SLUG = '';

// The sourceglance OAuth App: the opt-in "Sign in with full access". It needs the `repo`
// scope, which also allows writes, but reaches private repositories owned by others.
export const OAUTH_CLIENT_ID = 'Ov23lixibs7UUMrb4f7N';
