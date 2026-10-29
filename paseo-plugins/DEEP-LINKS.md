# Linking into Paseo

What a clickable URL can open in Paseo, per client, and how plugin code should
navigate instead. Read before building a dashboard, console or plugin that
sends someone to a workspace, tab, terminal or plugin screen.

Source: Paseo 0.12.0 app code (`packages/app/src/utils/host-routes.ts`,
`packages/app/src/plugins/routes.ts`, `packages/protocol/src/agent-deep-link.ts`,
`packages/desktop/src/main.ts`). Checked 2026-10-24 by reading that code;
`app.paseo.sh` answers deep paths with the app (HTTP 200). Rows marked
*untested* have not been clicked on a real client.

## Summary

| Client | What a URL can open |
|---|---|
| Web: `app.paseo.sh` or the installed PWA | Almost any screen: workspace, focused tab/terminal/file, agent, plugin screen with params, settings |
| Desktop (Electron) | Only `paseo://h/<serverId>/agent/<agentId>`: opens or focuses that agent; every other `paseo://` path is ignored |
| Android | `paseo://` scheme is registered; Expo Router should route any app path from it (*untested*). `https://app.paseo.sh` links open in Chrome, not the app (no app links) |
| Inside a plugin | Everything, on every client, through the plugin navigation API (below) |
| A link clicked inside Paseo (web, desktop) | With the `noice-chat-go-to-agent-links` plugin, `https://app.paseo.sh/h/<serverId>/agent/<agentId>` opens that tab in the same window (below) |

## Web routes

Prefix every path with `https://app.paseo.sh`. The page loads, connects to the
host, then shows the screen. The host must already be paired in that browser.
`<serverId>` is the daemon's server ID (`~/.paseo/server-id`, form `srv_…`).

| Target | Path |
|---|---|
| Workspace | `/h/<serverId>/workspace/<workspaceId>` |
| Workspace, chat tab focused | `/h/<serverId>/workspace/<workspaceId>?open=agent:<agentId>` |
| Workspace, terminal focused | `…?open=terminal:<terminalId>` |
| Workspace, file open | `…?open=file:<base64url path>` |
| Workspace, saved draft | `…?open=draft:<draftId>` |
| Workspace setup screen | `…?open=setup:<encoded workspaceId>` |
| Agent by ID (app finds its workspace) | `/h/<serverId>/agent/<agentId>` |
| Plugin screen, with params | `/h/<serverId>/plugin/<pluginId>/surface/<screenId>?param.<key>=<value>&…` |
| Plugin sidebar screen | `/h/<serverId>/plugin/<pluginId>/sidebar/<contributionId>` |
| Plugin settings screen | `/settings/hosts/<serverId>/plugins/<pluginId>/<screenId>` |
| App settings section | `/settings/<section>` |
| Host settings section | `/settings/hosts/<serverId>/<section>` |
| Project settings | `/settings/hosts/<serverId>/projects/<projectId>` |
| New-workspace form, prefilled | `/new?serverId=<id>&dir=<folder>&name=<name>&projectId=<id>&draftId=<id>` (all optional) |
| Sessions, schedules | `/sessions`, `/h/<serverId>/sessions`, `/schedules` |
| Open project | `/open-project`, `/h/<serverId>/open-project` |

App settings sections: `general`, `appearance`, `sidebar`, `chat`, `terminal`,
`browser`, `editor`, `shortcuts`, `integrations`, `notifications`,
`permissions`, `diagnostics`, `about`.

Host settings sections: `projects`, `connections`, `pair-device`, `agents`,
`metadata`, `workspaces`, `providers`, `usage`, `terminals`, `plugins`, `host`.

### Encoding rules

- Every path segment: `encodeURIComponent`.
- Workspace ID: as-is when it matches `[A-Za-z0-9._~-]+` (normal `wks_…` IDs
  do); otherwise `b64_` + base64url without padding.
- File path in `open=file:`: base64url of the UTF-8 path, no padding.
- The whole `open` value is URL-encoded as a query value.
- Plugin screen params: string keys and values only, each key prefixed
  `param.` in the URL. The screen receives them as `params` without the
  prefix, exactly as if opened with `openScreen({ screenId, params })`. So any
  screen that reads params is linkable from outside.

### Where the IDs come from

- Workspaces: `paseo workspace ls --json` (`workspaceId`).
- Agents: `paseo ls -g --json` (`id`).
- Terminals: `paseo terminal ls --workspace <id> --json`.
- Plugin screen IDs: the plugin's `openScreen({ screenId })` calls or its
  screen contributions.

## Desktop

The only external URL the desktop app accepts is

```
paseo://h/<serverId>/agent/<agentId>
```

with no query or hash. It opens or focuses a window on that agent. Workspace,
terminal, plugin-screen and settings URLs do nothing there. The other way in is
the CLI: `paseo <folder>` opens a project window.

`https://app.paseo.sh/...` links opened from outside Paseo open in the browser,
never in the desktop app. An installed PWA may take them over if the browser's
"open supported links" setting is on (*untested*). Clicked inside Paseo, see
the next section.

## Links clicked inside Paseo

Paseo itself sends every chat link to the system browser, its own links
included. The `noice-chat-go-to-agent-links` plugin (`noice-chat-go-to-agent-links/`) catches a plain left click
on exactly `https://app.paseo.sh/h/<serverId>/agent/<agentId>` (trailing slash
allowed) before Paseo does and opens that tab in the current window, on web and
desktop. Every other link, other `app.paseo.sh` paths included, and modifier or
middle clicks still go to the browser. Phones: no effect (no DOM). Checked live
on app.paseo.sh 2026-10-28; desktop *untested*. So in chat, that agent URL is
the link to write: it switches tabs inside Paseo and still works from anywhere
else.

## Not reachable by any URL

- A plugin's workspace side panel (e.g. a `PANEL_ID` panel).
- Header-button or composer-pill popovers.
- A specific message inside a chat (no scroll-to anchor).
- Prefilled composer text, except by linking an existing saved draft.

## From plugin code: use the API, not URLs

The client plugin API navigates on every client, phone included, without a
page reload:

- `navigation.openAgent({ agentId, serverId? })`
- `navigation.openWorkspace({ workspaceId, serverId? })`
- `navigation.openBrowser({ url, workspaceId, serverId? })`: built-in browser,
  desktop only (the field is absent elsewhere).
- `openScreen({ screenId, params })`: this plugin's screens; params land in the
  screen URL, so reload and history keep them.

Build a URL only for targets outside Paseo: webshare pages, Markdown notes,
notifications, other tools. There, web links reach the most; use a `paseo://`
agent link when the reader is on desktop and the target is a chat.

## Changing what links can do

Widening desktop (or Android) links needs an app change, not a server change:
desktop's `parseAgentDeepLink` only accepts the agent form. A server-only fork
cannot add it; it would be an upstream PR letting `paseo://` carry any app
path.
