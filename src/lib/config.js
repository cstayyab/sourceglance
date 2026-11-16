// Build-time configuration.

// Client ID of the sourceglance OAuth App, used for "Sign in with GitHub" (device flow).
// It is public by design: device flow needs no client secret. Register the app at
// https://github.com/settings/developers with "Enable Device Flow" checked (see
// docs/development.md). While empty, Settings offers only the personal access token.
export const OAUTH_CLIENT_ID = '';
