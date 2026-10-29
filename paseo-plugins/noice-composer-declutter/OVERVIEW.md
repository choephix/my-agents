Hides rarely used controls from the prompt bar (composer) in Paseo's web and desktop apps:
thinking effort, access mode, fast mode, other provider toggles (plan mode and the like), and
the idle Dictation and Voice mode buttons. Six switches, all off by default.

Open it from Command Center (⌘K / Ctrl+K) → Configure composer controls, or Settings → Plugins
→ noice-composer-declutter → Composer controls. Turn a switch on to hide that control. Each row's hint
says how to reach the control while it is hidden:
- Thinking, access mode and fast mode stay in Command Center (search Thinking, Mode, Fast);
  Shift+Tab in the prompt still cycles modes. Plan mode is in Command Center too; other
  provider toggles may not be, so turn that switch off to reach them.
- Dictation and Voice mode are hidden only while idle; Ctrl+D / Ctrl+Shift+D (⌘ on Mac) still
  start them, and recording, stop, cancel and mute controls always show.

Settings are stored on the host (`~/.paseo/plugin-settings/noice-composer-declutter/controls.json`).
The window you edit in updates at once; other open windows pick changes up when they regain
focus. iOS/Android are unaffected.

How it works: the client adds one `<style data-plugin="noice-composer-declutter">` with a
`display: none` rule per hidden control, scoped to the prompt bar
(`[data-testid="message-input-root"]`), so nothing else (sheets, menus) is touched and agent
settings never change. Hidden controls collapse fully: the remaining ones keep their spacing and
right edge. Unloading the plugin removes the stylesheet. The server entry only registers the
settings.

Hooks and their limits: thinking, mode and provider toggles use Paseo test IDs
(`agent-thinking-selector`, `mode-control`, `agent-feature-*`). In Paseo 0.12's compact web
layout, thinking is a readout inside the model button rather than a separate control.
The thinking switch hides that second text node too, leaving the model picker available.
This readout depends on the child structure of `combined-model-selector`.
Dictation and Voice mode have
no test IDs, so they match Paseo's accessibility labels ("Start dictation", "Enable Voice mode")
in all nine UI languages it ships. A Paseo update that renames these makes the control simply
stay visible. Voice hiding uses CSS `:has()` to drop its wrapper.

Screenshots (live web app, 2026-10-19):
- `composer-default.webp`: all switches off, nothing hidden.
- `composer-decluttered.webp`: all six on; only attachment, model and context meter remain.
- `settings.webp`: the settings screen with Stefan's choices (thinking, access mode, dictation).

Disable via Settings → Plugins, or `paseo plugin disable noice-composer-declutter`.
