# Tab dots

Small dots on each workspace row in the sidebar, one per tab, so you can see which workspaces have something waiting without opening them. By default every tab gets a dot: coloured ones for tabs that need you or are running, tiny faint gray ones for the rest, right after the workspace title, tabs waiting on you first.

Colours follow Paseo's own status colours:

- Green: the agent finished and you haven't looked yet.
- Red: error.
- Amber: waiting for your permission.
- Blue: running (only in the "Unread and running" and "Every tab" modes). A running dot rests small and dim, and a soft flash grows it to full size; several running dots flash one after another, left to right, and all rows keep the same beat. Still dots when **Animate running dots** is off or the system asks for reduced motion.
- Gray: read (only in "Every tab"). Read dots are smaller (3 px) and faint, so the coloured ones stand out.

Hover a dot to see the tab's title and state; click it to open that tab. A hovered dot grows; a gray one grows to the same size as a coloured one and brightens a touch, and a running one holds that size while its colour keeps pulsing. Every tab gets an equal slot for the pointer, so a grown dot never makes its neighbours harder to reach. The click goes through a blank plugin screen that hands over to Paseo's own tab navigation, so only the main pane changes; the sidebar and other plugins stay as they are. A clicked unread dot disappears at once; if Paseo hasn't marked the tab read within 5 seconds, it comes back. Dots never change under the pointer: while you hover a row's dots, updates for that row wait until the pointer leaves. Dots follow the tab order of that workspace on this device (all panes, left to right), unless **Dot order** puts waiting tabs first. Sub-agents are left out. For a workspace this device hasn't opened recently, tabs missing from the saved layout are added in the same order Paseo will add them the next time you open it.

## On phones

The phone apps can't put dots on each row, so they get one **Unread** row at the top of the sidebar instead, with one dot per tab waiting on you across all workspaces. It is hidden when nothing is unread. Tap it for a sheet listing those tabs (title, project and workspace, state, how long ago; the times refresh every 30 seconds while the list is open); tap a tab to open it. "Open as a screen" shows the same list full screen. With "Unread and running" or "Every tab", running tabs are listed too; read tabs never are. Web and desktop never show this row. Agent updates that change nothing in the row or list (sub-agents, read tabs) don't redraw it. Turned off, phones don't receive agent updates either.

## Settings

Settings → Plugins → noice-tab-dots → Tab dots, or ⌘K "Tab dots settings" (⌘K "Toggle tab dots" turns it on and off). Both commands show only on workspace pages, like other plugin commands.

- **Which tabs**: Unread, Unread and running, or Every tab (default).
- **Dot size**: Regular (5 px) or Small (4 px), up to 8 dots either way. Extra tabs show as a small, faint "+N"; tabs waiting on you are kept first, then running ones.
- **Replace the time** (on by default): rows with dots hide their last-activity time.
- **Dot position**: Right edge puts the dots where the time was; hovering the row brings back the row menu, so they move left by its width. Steady keeps them on the right but never moves them, leaving the menu's room free. Left (default) puts them right after the workspace title.
- **Dot order**: Tab order or Waiting first (default): tabs waiting on you, then running ones, then read ones, each in tab order.
- **Animate running dots** (on by default): off keeps running dots solid, in the same blue, in the rows and the hover tooltip. The system's reduced-motion setting stops the pulse either way. The phone Unread row never animates.

Settings are stored on the host, so every window and phone connected to it uses them. Replace the time, Dot position, Dot order and Animate running dots only apply to web and desktop. Changes show at once, in the settings screen and from ⌘K; if the host can't save one, it is undone and an error says so.

## Speed

Measured on Paseo 0.12.0 in the web app (40 sidebar rows, about 100 agents, 10 of them running):

- Clicking an unread dot: the dot is gone in 6–21 ms. The time until the tab shows has not been measured since the click switched to Paseo's own navigation (the old 0.35–0.5 s was for the previous method).
- ⌘K "Toggle tab dots": 50–100 ms from the click until all dots change. Re-measured on 2026-10-29 (web app 0.14.0 connected through the relay): off in 58 ms, on in 323 ms, since turning it on now starts a fresh agent listing.
- Settings switches: 3–11 ms.
- Drawing every row that has dots: under 2 ms.
- Streaming chats, terminals and other page changes outside the sidebar cost the plugin almost nothing; it redraws only when rows appear or agents change something a dot shows. Traced on 2026-10-29 (39 rows, a reply streaming): the whole plugin took 0.17 ms per second, its page-wide change watcher 0.02 ms of that; idle, 0 ms.
- Turned off, the plugin runs nothing: no agent subscription, no layout polling, no page watcher, no listeners. Only a settings read when the window regains focus remains, so turning it on in another window shows here. Before this change, "off" still cost 0.05–0.19 ms per second.
- With several hosts connected, each host's copy draws only that host's rows.
- Running dots pulse on the GPU compositor alone. As a CSS animation each pulse woke the page once per beat (React listens for the animation's iteration event, so the browser has to stop and fire it), and each of those wake-ups restyled and repainted the whole app; the dots now play the same pulse as a Web Animation, which has no such event. The look and the left-to-right wave are unchanged. Measured in a test setup with 5 running dots: page frames drawn by the main thread went from about 7 to 2.6 per second. Dots in a hidden sidebar don't pulse (nobody sees them), so they cost nothing there either.

## Limits

- Row dots are web and desktop only: Paseo has no plugin slot in sidebar rows, so they are added to the page directly.
- Opening a tab, from a row dot or the phone sheet, goes through a plugin screen (Paseo lets only plugin screens open a tab), so you may see it for a moment. The phone sheet was tested at phone width in the web app; not yet on the iOS or Android apps. Workspace names in the sheet load in the background as soon as the Unread row shows.
- "Mark as read" on a workspace leaves permission requests flagged until you answer them, so amber dots stay.
- Tested on Paseo 0.12.0 in the web app, grouped by project and by status.
- It reads Paseo's internal tab layout from the browser's storage and the row's internal structure. A Paseo update can change either: the order then falls back to Paseo's default, or the dots stop showing. The sidebar itself keeps working.
