Agents often link to another Paseo chat tab as `https://app.paseo.sh/h/<serverId>/agent/<agentId>`.
Without this plugin, clicking such a link opens the Paseo web app in your browser. With it, a plain
click switches to that tab in the Paseo window you are already in, and no browser opens.

Only that exact link form is handled, with or without a trailing slash. Every other link, including
other `app.paseo.sh` paths and links with a query or `#` part, behaves as before. Ctrl, Cmd, Shift
and Alt clicks and middle clicks are not touched either.

## Previews of linked chats (optional, off by default)

Settings → Plugins → Agent links → **Preview linked chats**. When it is on, an agent link that sits
on a line of its own in an assistant reply (bare, `<…>` or `[label](…)`) is replaced by a small card:
the linked chat's title, its state (working, needs permission, error, or how long ago its last
message was) and its last three messages in a 240 px window scrolled to the bottom, so a question
the chat asked is readable without opening it. Clicking the card opens the tab; links inside the
card work as links.

- Links inside a sentence, in list items, in bold or in code stay plain links, so a reply listing
  several tabs is not buried under cards.
- A link to an archived, unknown or unreachable chat stays a plain link.
- A preview is a snapshot taken when the card is drawn: it does not follow the linked chat while
  you look at it. Opening the chat again, or the card scrolling back into view, takes a new one.
- A reply that is still streaming renders as usual; the cards appear when it completes.
- A reply that gets a card loses Paseo's footer under it (copy button and time), because the reply
  is redrawn by the plugin in parts.
- A reply that also has a `![[file]]` embed for the Message embeds plugin has not been tried; both
  plugins rewrite whole replies, so expect only one of them to apply.
- The setting is stored on the host, so it applies to every app connected to it. Turning it on or
  off takes effect at once, without a reload.

To draw a card the app reads the newest 20 timeline entries of the linked chat from the host, and up
to 80 more when tool calls crowd out the messages. Through app.paseo.sh a card filled in about
0.15 s after its frame appeared when switching tabs, and about 0.8 s after the chat text on a fresh
page load.

## Where it works

The desktop app and the web app. Click handling watches clicks on the page, which the iOS and
Android apps do not have; there links behave as before. Previews use only cross-platform parts but
have not been tried on the phone apps.

While a tab opens, an "Opening tab" plugin screen shows for a moment.

The link's server ID is passed on, so a link to a chat on another connected host should open, and
preview, that host's chat (not tested with a second host).

## Tested

Checked 2026-10-28 in the web app (app.paseo.sh) against a 0.13.0 daemon, as a stand-in for
desktop, which runs the same app code: a plain click on an agent link in a chat switched to that tab
with no new browser tab; a GitHub link, a workspace link and a Ctrl click on the agent link each
opened a browser tab as before. With previews on: the card showed the linked chat's last messages,
a click on it opened that chat, a link inside it opened its own target, archived and unknown chats
stayed plain links, and a streaming reply rendered normally and gained its card when it finished.
With previews off the same reply rendered exactly as without the plugin. Not yet tried in the
desktop app.
