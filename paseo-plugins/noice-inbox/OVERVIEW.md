# Notifications

A notification list in the sidebar. Paseo's desktop notification for a finished turn disappears if you
don't click it; this keeps it. The **Notifications** row at the top of the sidebar shows how many
entries are unread. Press it to open the list: a popover on wide screens, a bottom sheet on phones.

## What it lists

- **Finished**: an agent's turn ended. The preview is the start of the agent's final reply.
- **Error**: a turn failed. The preview is the error message.
- **Needs permission**: an agent asked for permission. The preview names the tool and what it wants.

An agent has at most one entry of each kind. A newer finished turn from the same agent replaces its
older finished entry and moves it to the top; a permission request doesn't touch the agent's
finished entry. Canceled turns are not listed. Sub-agents are not listed either: they report to their
parent agent, and Paseo doesn't send notifications for them.

## Read, unread and removal

- An entry is unread until you see the agent. A finished or error entry turns read when Paseo clears
  the agent's unread marker, which happens when you open the agent in any Paseo client, whether you
  get there from the list or not. A permission entry turns read once the request is answered.
- Pressing an entry opens that agent and marks the entry read.
- Read entries stay in the list, greyed out, until a newer one of the same kind replaces them or you
  remove them with their × or **Clear all**.
- Archiving an agent removes its entries. Entries of agents archived or deleted while the plugin was
  off are dropped the next time the list loads.

## Where the data lives

Entries are recorded by the daemon whether or not an app is open, and saved to
`$PASEO_HOME/plugin-data/inbox/entries.json` (by default `~/.paseo/plugin-data/inbox/`). The list
holds at most 300 entries; the oldest go first.

## Limits

- The sidebar count updates about 1.5 seconds after an agent changes state, because the client
  reloads the list after an agent update rather than receiving it pushed. Paseo 0.14 has no plugin
  push channel.
- Agent titles are shown live for the newest 200 agents; older entries show the title the agent had
  when the entry was made.
- Finished and error entries follow Paseo's own unread marker (the dot on the agent's tab): one
  stays unread here exactly as long as that dot shows.
