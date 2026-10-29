# Nilometer

Nilometer is the read-only inbox and doing board inside Paseo. It displays the cards Axalon Mainframe exposes through `/desk.json`, with Inbox and Doing tabs.

Open it from the "Nilometer" row at the top of the sidebar or from the command center. The row shows how many unsettled, blocking Inbox cards are waiting.

## What it shows

The screen uses Paseo's own style: its tab strip, project badges and status colours, with compact type so more cards fit.

- Inbox and Doing tabs show live counts. Inbox has a filter button that steps through blocking, revisit and whenever priorities.
- Cards are grouped by their asker or owner. Tap a heading to fold a group into a pill above the board. Settled cards are kept in a folded group at the end.
- Each card shows its title, answers, a short body lead, blocks in a small red callout, hashtags, the first link, pull requests not already in the text, and its asker or owner.
- Doing cards include links to their memos. Links open externally, while a linked Paseo agent opens in its tab.
- Pull request numbers are coloured by their GitHub state: purple for merged, green for ready to merge, amber for open but not ready, red for conflicts, gray for drafts, and struck through when closed.
- Tap a card to open a Paseo dialog with the full body, answers, every pull request, people, links, hashtags and the source URL.
- Tap the asker or owner to open that agent. On an Inbox card this also copies a `Re:` pointer to the card URL so it can be pasted into the prompt. When a tab is gone, tapping copies the command that revives it.

On a phone the groups become sections in one list; pull down to read the desk again.

## Where the data comes from

The plugin reads `http://127.0.0.1:7070/desk.json` from Axalon Mainframe on the daemon's machine. Mainframe owns the desk parser and GitHub snapshot; Nilometer only validates and renders the response. It reads the desk when the screen opens and when the app comes back into focus. It never polls.

If Mainframe isn't running, the screen says so and offers to try again.
