# Sleeping tabs (`noice-omp-sleeping-tabs`)

Shows which OMP chats are asleep and lets you wake them. "Asleep" is a feature of a custom daemon
fork: after an idle time the daemon closes an OMP chat and
frees its memory (about 250–290 MB each). The conversation stays readable without starting OMP,
and the chat starts again when you send a message or press Wake. This plugin is the UI for that, in
the official apps (web app.paseo.sh, desktop, Android), served by the daemon like any plugin.

**Needs the fork.** On the official daemon it shows nothing except one muted line in its settings
screen: "This Paseo server can't sleep agents." No pill, no ⌘K entries, no `/wake` or `/sleep`.

## In a chat

An asleep chat gets a small pill above the composer: 💤 `14:20 · Wake` (local time it fell
asleep; `Mon 14:20` within the last week, `Oct 12` before that; `Asleep · Wake` for a chat closed
by a daemon restart, which has no sleep time). Hover text: "Asleep since 14:20. Wake. Sending a
message also wakes it." The pill shows only in that chat's composer, so you see it exactly while the
chat you're looking at is asleep.

- **Wake:** press the pill. It turns into Paseo's own busy pill (spinner, "Waking…") and disappears
  once the chat is running again (about 1 s in the tested setup).
- **Send:** just send. The message goes through and the pill disappears as the chat starts.
- **`/wake`:** same as pressing the pill.
- **Wake failed:** the pill turns into ⚠ `Failed · Retry` (red icon) and Paseo shows its error
  toast, e.g. "Couldn't wake: Provider 'omp' is not available…". Press it to retry. Your draft stays
  in the composer.

Paseo caps a composer pill at 160 px (about 110 px of text), so the designed "Asleep since 14:20 ·
Wake" and "Couldn't wake · Retry" didn't fit; the pill uses the short forms above and the hover text
carries the full sentence.

## Sleep a chat now

`/sleep` in a chat's composer, or ⌘K "Sleep this chat" (web and desktop; the phone layout has no
⌘K), puts that chat to sleep at once, even while it is open and focused. Its OMP process stops and
the 💤 pill appears. When it can't sleep, Paseo's error toast says why: "Can't sleep: it's working
right now.", "…it's waiting for your permission.", "…a background job is still running.", "Only
OMP chats can sleep." or "This chat is already asleep."

| | | |
| --- | --- | --- |
| ![](screenshots/slash-sleep-desktop.png) | ![](screenshots/cmdk-sleep-desktop.png) | ![](screenshots/sleep-refused-desktop.png) |
| ![](screenshots/slash-sleep-autocomplete-phone.png) | ![](screenshots/sleep-refused-phone.png) | ![](screenshots/official-cmdk-no-sleep.png) |

## Settings

Settings → Plugins → noice-omp-sleeping-tabs → Sleeping tabs, or ⌘K "Sleeping tabs settings".

- **Now:** "3 asleep · ~0.8 GB freed" (the memory each chat used when it went to sleep, added up;
  chats closed by a restart aren't measured and are counted separately), and, when there are any,
  "2 kept awake" with each chat's title and why: running, waiting for permission, background job,
  open on a device. Refreshes every 15 s while the screen is open.
- **Sleep idle chats:** on/off, off by default.
- **Sleep after:** 30 minutes, 1 hour (default), 2 hours, 4 hours, or Custom… (1–10080 minutes).

The settings live in the daemon's `config.json`, not in the plugin: `agents.providers.<id>.sleep =
{enabled, idleMinutes}`, written for every provider whose chats can sleep (OMP and providers that
extend it, e.g. `omp` and `omp-nilo`; the screen says which). Every device sees the same values.
Saving rebuilds the daemon's provider list, the same as any provider edit in the app.

| Chat | | |
| --- | --- | --- |
| ![](screenshots/pill-desktop.png) | ![](screenshots/waking-desktop.png) | ![](screenshots/awake-desktop.png) |
| ![](screenshots/sent-wakes-desktop.png) | ![](screenshots/wake-failed-desktop.png) | ![](screenshots/app-paseo-sh-pill.png) |
| ![](screenshots/pill-phone.png) | ![](screenshots/wake-failed-phone.png) | |

| Settings | | | Official daemon |
| --- | --- | --- | --- |
| ![](screenshots/settings-desktop.png) | ![](screenshots/settings-idle-menu.png) | ![](screenshots/settings-phone.png) | ![](screenshots/official-settings.png) ![](screenshots/official-no-pill.png) |

## How it works (for agents)

- `index.server.ts` + `server/sleep.ts`: the daemon half. Feature-detects the fork with
  `typeof paseo.agents.sleepState === "function"` (a version check can't: the fork reports
  `0.12.0`). RPCs in `shared/rpc.ts`: `sleep.pills` (asleep chats with workspace and sleep time),
  `sleep.overview` (settings data), `sleep.wake` (`paseo.agents.ref(id).wake()`), `sleep.sleep`
  (`paseo.agents.ref(id).sleep()`; refusals come back as a plain sentence, not an error),
  `sleep.configure` (`paseo.config.patch` of `providers.<id>.sleep` for every provider in
  `sleepState().providers`).
  Titles and workspaces come from the agent directory (`agents.list`, storage only; it never starts
  an agent).
- `index.client.tsx`: asks `sleep.pills` once (retries at 2/5/15 s while the daemon half starts);
  only on a fork does it register the pills, the ⌘K entries, `/wake` and `/sleep`. The settings screen is always
  registered.
- `client/pills.ts`: one `addComposerPill` per asleep chat. It follows the app's agent directory
  subscription and asks the daemon (`sleep.pills`, debounced 400 ms) only when a chat closes; a chat
  that starts again loses its pill at once without a daemon call. No polling.
- `client/settings.tsx`: the settings screen (Paseo's settings components).
- `client/format.ts`: times and sizes (`npm test`).

Apply edits: `npm run typecheck && paseo plugin reload noice-omp-sleeping-tabs`.

## Known limits

- Phones have no hover, so the pill's "Sending a message also wakes it" is not shown there
  (Paseo disables pill tooltips on mobile).
- The pill text is short because of Paseo's 160 px pill cap (above).
- The freed figure counts only chats the fork put to sleep itself; after a daemon restart every
  OMP chat is closed and shows the pill, but its memory isn't measured.
- ⌘K "Sleep this chat" shows for every focused chat on a fork daemon, not only awake OMP chats:
  Paseo 0.12 ⌘K items have no per-chat visibility (`plugins/command-center/contributions.ts`
  adds every agent item with `visibility: "always"`). On a chat that can't sleep it shows the reason
  in a toast instead.
- A wake is the fork's normal start; if OMP can't start (provider broken), only Retry is offered.
- Tested on the fork test daemon (web UI at desktop and phone width, and app.paseo.sh) and on the
  official 0.12.0 daemon. Not tested in the native Android app; the plugin uses only cross-platform
  surfaces (composer pill, settings screen, ⌘K, slash command).
