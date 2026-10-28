# Vizier desk

The Vizier desk inside Paseo: the asks waiting on you, the work agents have in flight, and the endeavors, laid out the way Axalon Mainframe's `/desk` page shows them.

Open it from the "Vizier desk" row at the top of the sidebar, or from the command center. The row shows how many live asks are blocking.

## What it shows

The screen is drawn in Paseo's own style: its tab strip, project badges and status colours, with type a step smaller than chat so more fits.

- One column per workspace, headed with the workspace's project badge, its name and a count. A red dot and number mark columns with blocking asks. The column with the most urgent card comes first. Tap a heading to fold the column into a pill above the board.
- Asks, Doing and Endeavors as tabs with live counts; Endeavors appears when there is one. On Asks, a filter button steps through the priorities.
- Square cards with a short mark beside the title in the card's state colour: red blocking, amber revisit, gray whenever, blue in flight (fainter when quiet), faint green settled.
- On each card: the title, the answer you gave, a short lead, what the card blocks in a small red callout, and one line under a hairline with the asker, the first link, PRs not already in the text, and the age. The age turns amber after a day.
- PR numbers coloured by their state on GitHub, with GitHub's icon for the state: purple for merged, green for ready to merge, amber for open but not ready, red for conflicts, gray for drafts, struck through when closed.
- Tap a card to open it in a Paseo dialog (a sheet on a phone) with the whole text, every pull request, everyone involved, every link, the times and the file.
- Tap the asker to open that agent. When its tab is gone, tapping copies the command that revives it.
- Settled cards and cards outside a live state, in two folded columns at the end.

On a phone the columns become sections in one list; pull down to read the desk again.

## Where the data comes from

The plugin reads `http://127.0.0.1:7070/desk.json` from Axalon Mainframe on the daemon's machine. Mainframe parses the desk folder and keeps the GitHub snapshot the PR colours come from; the plugin parses nothing itself. It reads the desk when the screen opens and when the app comes back into focus. It never polls.

If Mainframe isn't running, the screen says so and offers to try again.
