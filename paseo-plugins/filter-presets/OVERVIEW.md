Filter presets adds a compact row of All, your named presets, and Other buttons to the web sidebar. Choose a button or use the Command Center entries named “Filter preset: …”. All is the initial selection. Other appears only when at least one project matches no preset. Projects can match more than one preset and appear in each.

Requires Paseo 0.12.0 or later. Native iOS and Android clients receive no buttons, commands, or settings screen.

## Definitions

Open Settings → Plugins → Filter presets → Filter presets. Each preset is a card with its name, its rules, and a live preview. A project is included when any of its rules matches. Definitions are stored on the daemon and shared with its connected clients. Nothing changes until you press Save; Discard changes returns to the saved definitions.

Each rule is a type and a value:

- **Inside folder**: an absolute directory path. Matches that directory and everything below it, not similarly named neighbors. Example: `/home/user/workspace/work`.
- **Path has a folder named**: a folder name matched against every folder in the project path, anywhere. `*` matches any characters. Example: `acme-*` matches `/home/user/workspace/acme-app` and `/home/user/.paseo/worktrees/acme-worktree/feature`. One name only, without `/`.
- **Git remote**: a pattern against the remote in Paseo's project key. `acme/*` is shorthand for GitHub; a full pattern such as `github.com/acme/*` or `gitlab.com/team/*` also works. GitHub patterns ignore case, as Paseo stores GitHub owners and repositories in lower case; other forges are case-sensitive. Repository subdirectory suffixes are ignored.
- **Path pattern**: a case-sensitive pattern against the full project root path. `*` matches any characters except `/`, `**` includes `/`, and `?` matches one non-`/` character. Example: `/home/user/workspace/acme-*`.
- **Path regex**: a JavaScript regular expression against the project root path, without surrounding slashes or flags. Add `^` and `$` when you want an anchored match.

Use absolute paths as seen by the daemon. `~` and environment variables are not expanded, so "Inside folder" and "Path pattern" values must start with `/` (or a drive such as `D:\` or a `\\server\share` path on Windows); the form says so before saving. Windows paths (rule values and project roots starting with a drive or `\\`) compare with `\` and `/` interchangeable and the drive letter in either case, except in Path regex, which sees the raw path. Other paths compare as written.

The initial synthetic Acme preset has two "Path has a folder named" rules, `acme` and `acme-*`. Customize these in settings for your own folders. Existing saved definitions are preserved.

Under each preset, "Matches N projects" lists the projects the rules on screen match, including edits you have not saved. Projects that the saved version did not match are outlined in green with a `+`. A rule with a problem (an empty value, an invalid regular expression, a folder name with `/`) shows its error under the field and is left out of the preview. An empty preset name or a preset without rules also shows an error. Save stays disabled until every problem is fixed.

The Other card lists the projects no preset matches, with their paths. It shows the first five; "+ N more" shows the rest. Each row has an "Add to" menu: choosing a preset adds a rule for exactly that project, and "New preset…" creates a preset named after the project with that rule. The rule is "Inside folder" with the project's path, or "Path pattern" with the exact path when another project lives inside that folder (for example `/mnt/notes` contains `/mnt/notes/Example Team`), so only the chosen project is added. Review the preview and press Save to keep it.

Save takes about 0.3 to 0.6 s through app.paseo.sh, showing "Saving…" meanwhile. Edits typed during a save are kept. If the daemon refuses, for example because the definitions were changed from another window, the error shows under the form and your edits stay.

"+ Add preset" adds an empty card. A new preset gets its ID from its name when saved (`Client Work` becomes `client-work`, with a number added if the ID is taken). Renaming a saved preset keeps its ID, so the sidebar selection stays.

### Edit as JSON

"Edit as JSON" swaps the form for the raw definitions; "Edit with form" goes back. Save checks the whole array the same way: valid rules, regular expressions, and unique IDs. "Reset to defaults" there restores the synthetic initial definition. An agent can edit the same host-side settings document under the plugin's `presets` settings ID. Each preset has an `id`, a display `name`, and one or more `rules`. IDs start with a lowercase letter and contain lowercase letters, digits, or hyphens. `all` and `other` are reserved. Rule types in JSON: `folderPrefix` (Inside folder), `folderName` (Path has a folder named), `remoteGlob` (Git remote), `pathGlob` (Path pattern), `pathRegex` (Path regex).

```json
[
  {
    "id": "acme",
    "name": "Acme",
    "rules": [
      { "type": "folderName", "value": "acme" },
      { "type": "folderName", "value": "acme-*" }
    ]
  }
]
```

## Selection

The selected button is browser-local by design: each browser and the desktop app keep their own choice, and it survives page and plugin reloads using `paseo-plugin:filter-presets:selected`. Definitions changing or a missing Other group can make the effective selection fall back to All.

The browser also remembers the last stylesheet per host (`paseo-plugin:filter-presets:css`) and shows it the moment the plugin loads, so a page load doesn't show every project while definitions and projects are fetched. The current sheet replaces it as soon as they arrive (typically 0.5 to 4 s later through app.paseo.sh); a project added or changed since the last visit can be hidden or shown wrongly for that moment. Choosing All forgets it. Before Paseo loads its plugins (about 2 to 3 s after a page load through app.paseo.sh) no plugin can hide anything, so the full sidebar still shows briefly.

## Behavior and limits

The plugin reads the selected host's project names, root paths, and project keys through Paseo's existing connection. It hides unmatched sidebar project groups and their workspace rows using the web sidebar's `data-testid` hooks. Disabling it removes its stylesheet and restores those groups. It does not alter Paseo's Project filter, delete projects, or prevent opening a workspace elsewhere. No data is sent to a third-party service.

Both sidebar groupings are filtered: "group by project" hides whole project groups, "group by status" hides the individual workspace rows of non-matching projects, and a status section whose rows are all hidden disappears with its heading. A section with "Show more" stays (its unshown rows may match), and its count still includes hidden rows. Pinned workspace rows are never filtered, in either grouping. Built-in Project filters and collapsed project groups still affect what is shown. These are sidebar display presets, not access controls.

The plugin keeps a live list of the first 200 workspaces from the daemon, so a workspace created in a hidden project is hidden about half a second after it appears in "group by status" (measured 0.3 to 0.5 s through app.paseo.sh; the gap is the project lookup for a brand-new project). Rows of workspaces beyond the first 200 are not hidden in "group by status". The project list is reused for 30 s (opening settings shows it at once without a refetch) and refreshed immediately when the daemon reports a project change. Switching presets costs about 1 to 3 ms before the sidebar restyles. Pinned workspaces always stay visible, by design.
