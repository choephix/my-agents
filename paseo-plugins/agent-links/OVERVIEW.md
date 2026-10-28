Agents often link to another Paseo chat tab as `https://app.paseo.sh/h/<serverId>/agent/<agentId>`.
Without this plugin, clicking such a link opens the Paseo web app in your browser. With it, a plain
click switches to that tab in the Paseo window you are already in, and no browser opens.

Only that exact link form is handled, with or without a trailing slash. Every other link, including
other `app.paseo.sh` paths and links with a query or `#` part, behaves as before. Ctrl, Cmd, Shift
and Alt clicks and middle clicks are not touched either.

## Where it works

The desktop app and the web app. The plugin watches clicks on the page, which the iOS and Android
apps do not have; there it does nothing and links behave as before.

While the tab opens, an "Opening tab" plugin screen shows for a moment.

The link's server ID is passed to Paseo's navigation, so a link to a chat on another connected
host should open there (not tested with a second host).

## Tested

Checked 2026-10-28 in the web app (app.paseo.sh) against a 0.13.0 daemon, as a stand-in for
desktop, which runs the same app code: a plain click on an agent link in a chat switched to that tab
with no new browser tab; a GitHub link, a workspace link and a Ctrl click on the agent link each
opened a browser tab as before. Not yet clicked in the desktop app.
