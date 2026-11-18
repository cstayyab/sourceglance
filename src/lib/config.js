// Build-time configuration. Client IDs are public by design: device flow needs no client
// secret. See docs/development.md for registering the apps.

// The sourceglance GitHub App: the default "Sign in with GitHub". Its permissions are fixed
// to Issues, Pull requests and Projects (read and write) plus read-only Metadata, and it
// only sees the repositories it is installed on. No code, settings or admin access.
// While empty, the default sign-in is unavailable.
export const GITHUB_APP_CLIENT_ID = 'Iv23liXr0uuVtDh96Z4k';
// The app's URL name, from https://github.com/apps/<slug>, for "Choose repositories".
export const GITHUB_APP_SLUG = 'sourceglance';

// Set to true to also offer "Sign in with full access" (the OAuth App below) when adding a
// github.com account. A personal access token is always offered (ADR 0007).
export const SHOW_OTHER_SIGN_IN_OPTIONS = false;

// The sourceglance OAuth App: the opt-in "Sign in with full access". It needs the `repo` and
// `project` scopes, which allow writes everywhere, but reaches private repos owned by others.
// Empty: no OAuth App is registered, so this option stays unavailable even when shown.
export const OAUTH_CLIENT_ID = '';

// The sourceglance GitLab application (gitlab.com → Preferences → Applications): not
// confidential, scope `api`, Device authorization grant enabled. Public by design.
export const GITLAB_CLIENT_ID = 'b21497a4740f5b6acda34fd45ac48f42529611120e526a55ce85b505bbdf19f3';

// Project links and author, shown on the About page.
export const AUTHOR_NAME = 'Mohammad Omer';
export const AUTHOR_GITHUB = 'omer-gh';
export const REPO_URL = 'https://github.com/omer-gh/sourceglance';
export const HOME_URL = 'https://omer-gh.github.io/sourceglance/';
