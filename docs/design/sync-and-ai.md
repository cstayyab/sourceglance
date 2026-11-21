# Sync server and AI assistant

Both are optional. Without a sync server the app does everything except the AI assistant, and nothing is sent anywhere.

## Signing in to a server

Settings → Sync server. Pick **Source Glance Cloud** or enter another server's address (`https://`; plain `http://` only for
this computer). The app asks the server for a one-time code and shows it (and copies it). You sign in on the server's page in your
browser and paste the code there; nothing is filled in for you. The app then receives a long-lived token for this
computer, keeps it in the GNOME keyring, and the server lists it under Devices where you can revoke it. Signing out
forgets the token and keeps every account already on this computer.

When you connect you choose what to turn on. The same switches stay on the page:

| Switch | Default | What it does |
| --- | --- | --- |
| Launch in AI button | on | Fetches the AI instructions. Off, the AI buttons show a padlock whose popover says why |
| Encrypted cloud backup of account tokens | off | Sends account tokens to the server (encrypted there) and brings them back on your other computers |
| Save settings | always on | Syncs the settings below |

## What follows you

- **Accounts** signed in with a personal access token (browser sign-ins stay on the computer that made them). With token
  backup off, no account token is sent to or from the server.
- **Settings:** Group by, organization names, project names, hidden boards, watched repositories and your AI additions.
  The top bar switch, its layout and the lists it shows stay on each computer.
- An account removed on one computer is removed on the server; one removed on the server is kept on a computer that still
  has it. Settings are saved by revision; when two computers changed the same thing, the newer revision wins.

## The AI assistant

Settings → AI assistant: pick a command-line agent (or None), see the server's instructions (read only), and add your own
additions. Each issue and pull request then has an AI button that opens the agent in a terminal in the repository's folder,
with the item as its first message. The first time it asks where the repository is on this computer. The comment box has
**Suggest**, which drafts a comment from what you typed; the draft only fills the box.

The instructions come from the server, so the buttons stay off until you are signed in to one.

## The requests a server must answer

For anyone running a compatible server. The builders and parsers are in [src/shared/sync.js](../../src/shared/sync.js).

| Request | Purpose |
| --- | --- |
| `POST /api/device/code`, `POST /api/device/token` | The code sign-in |
| `GET /api/sync/state` (`?tokens=0` to leave tokens out) | Accounts, settings and the plan |
| `PUT /api/sync/accounts`, `DELETE /api/sync/accounts/{id}` | Add or remove a synced account |
| `PUT /api/sync/settings` | Save settings, with the revision they were based on |
| `POST /api/sync/signout` | Revoke this computer's token |
| `GET /api/ai/prompts` | The AI instructions |
