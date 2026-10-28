# Vizier desk

The Vizier desk inside Paseo: the asks waiting on you, the work agents have in flight, and the endeavors, laid out the way Axalon Mainframe's `/desk` page shows them.

Open it from the "Vizier desk" row at the top of the sidebar, or from the command center. The row shows how many live asks are blocking.

## What it shows

- One column per workspace, headed in that workspace's colour. The column with the most urgent card comes first. Tap a heading to fold the column into a pill above the board.
- Asks, Doing and Endeavors as three views, with live counts. On Asks you can narrow the board to one priority.
- Cards in the desk's own order: priority dot, title, the answer you gave, a short lead, the rest under "more", what the card blocks, its priority and its age.
- PR numbers coloured by their state on GitHub: purple for merged, green for ready to merge, amber for open but not ready, red for conflicts, gray for drafts, struck through when closed. PRs mentioned only in the body show as chips under the text.
- The asker's tab. Tap it to open that agent. When the tab is gone, tapping copies the command that revives it.
- Settled cards and cards outside a live state, in two folded columns at the end.

On a phone the columns become sections in one list; pull down to read the desk again.

## Where the data comes from

The plugin reads `http://127.0.0.1:7070/desk.json` from Axalon Mainframe on the daemon's machine. Mainframe parses the desk folder and keeps the GitHub snapshot the PR colours come from; the plugin parses nothing itself. It reads the desk when the screen opens and when the app comes back into focus. It never polls.

If Mainframe isn't running, the screen says so and offers to try again.
