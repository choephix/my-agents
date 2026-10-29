# Working indicator (`noice-chat-turn-status`)

Replaces what Paseo shows at the bottom of a turn while an agent works. Three separate settings,
each with its own "Off":

| Setting | Choices | Default |
| --- | --- | --- |
| Spinner | Off, Paseo smooth, Typing dots, Typing bubble, Jelly dots, Words, Orbit, Twin comets, Comet arc, Binary pair, Atom, Eclipse, Moon phases, Morph, Starburst, Constellation, Bounce, Sideways bounce, Hop across, Cradle, Braille trail, Snake, Triangle hop, Sliding tiles, Ripple grid, Flip tile | Paseo smooth |
| Live activity | Off, Shimmer, Rolling, Typed, Icon | Off |
| Elapsed time | Off, Plain, Shimmer, Rolling, Warming | Shimmer |

"Paseo smooth" is Paseo's own 2×3 dot grid with the same six frames, faded instead of stepped
(Paseo's steps at about 6 fps). Live activity shows what the agent is doing right now ("Reading
overrides.ts", "Running git status", "Thinking", "Writing"), read from the newest tool row of that
turn; "Icon" puts the tool's own Paseo icon inside the same shimmer. "Warming" hides the time for the
first minute, fades it in up to 5 min, then turns it amber and, by 15 min, red.

Web and desktop apps only. The native phone apps keep Paseo's own indicator.

**Settings:** ⌘K → "Working indicator settings", or Settings → Plugins → Working indicator. Every
choice is a live, clickable tile; the preview at the top shows the three settings combined, as in a
real turn. Saved per host; other open windows pick it up on focus.

| Settings | | Footer |
| --- | --- | --- |
| ![](screenshots/settings-top.webp) | ![](screenshots/settings-bottom.webp) | ![](screenshots/footer-default.webp) ![](screenshots/footer-icon-rolling.webp) ![](screenshots/footer-orbit-typed-warming.webp) |

## How it works (for agents)

- `shared/preferences.ts`: the settings document (`indicator`), the picker order and names.
- `client/catalog.ts`: all CSS (every spinner is pure CSS sized in em, class/keyframe prefix `spn-`)
  and each spinner's markup. Add a spinner: one entry in `SPINNERS` + `SPINNER_NAMES`, one in
  `SPINNER_MARKUP`, its CSS here.
- `client/web.ts`: the DOM side. `startIndicator()` watches the page and restyles every
  `[data-testid="turn-working-indicator"]`: hides Paseo's loader (first child of the footer's content
  row) and puts ours in the same wrapper, inserts the live label after it, and styles
  `[data-testid="turn-working-elapsed"]` (warming) or hides it behind our own copy (shimmer, rolling). The live label reads the newest
  `[data-history-row-id]` row of the same `[data-testid="agent-chat-scroll"]`
  (`tool-call-badge`/`tool-call-group` name + summary + icon). The same controllers drive the
  settings demos.
- `client/settings.tsx`: the settings screen (React Native tiles with empty spans the web module fills).
- Elements it adds carry `data-spn-own`, so their own animations never wake the page observer.
  Footers are picked up from the nodes Paseo adds, and a frame redraws them only when a footer
  mounts or its own text changes (with live activity on: any change while a footer is shown); a
  streaming reply's text alone wakes nothing. Disabling the plugin puts every footer back exactly
  as Paseo drew it.

Apply edits: `flock /tmp/paseo-plugin.lock paseo plugin reload noice-chat-turn-status`. Checks: `npm run typecheck`, `npm test`
(`client/web.test.ts`, vitest + jsdom).

## Runtime cost (applied 2026-10-21)

Every animation runs on the compositor as a Web Animation (only `transform` and `opacity` change,
plus starburst's `clip-path`, which Chromium composites), so a running turn in view costs the page's
main thread nothing between steps.

- **Warming** steps every 10 s with no transition (`warmth()` in `client/web.ts`). It used a 1 s
  `color`/`opacity` transition re-aimed by every 1 s elapsed-text update, i.e. a main-thread
  animation running for the whole 1–15 min ramp. A 10 s step moves at most 5 % opacity or a
  thirtieth of the colour blend.
- The footer writes `data-spn-spinner`, `data-spn-time` and the warming variables only when their
  value changes (each write restyles the footer).
- **Shimmer** (time style, live styles shimmer/rolling/icon) is a sheen built from transforms
  (`addSheen`/`SheenText` in `client/web.ts`, `.spn-gl` in `client/catalog.ts`): muted text, and
  over it a bright copy seen through a window whose static mask is the band. The window slides
  right while the copy inside slides left by the same amount, so the glyphs stay put and only the
  band moves. It replaced a `background-position` animation on `background-clip: text`, which
  repainted on the main thread every frame while a turn was in view. Same 100° band, 300 % width
  and 1.8 s sweep as before. The shimmer time style now hides Paseo's elapsed text and shows our
  copy in the same font (as rolling always did); the icon style's one band covers icon and text.
- **Spinners** that animated main-thread properties now run on the compositor, same look:
  binary pair drops its `z-index` keyframes (both dots are one colour, so stacking never showed);
  atom and eclipse draw the orbiting body twice, under and over the centre body, and swap the two
  with step-end opacity where the `z-index` used to flip (`depthSwap()`); moon phases slides the
  masked element and counter-slides the moon inside it (the old `mask-position` sweep); morph
  (`border-radius`) spins a wrapper and changes shape as a flipbook of pre-drawn copies, one shown
  per display frame by step-end opacity (`flipbook()`: 96 slots per cycle = one per 60 Hz frame,
  49 copies, each slot centred on a frame time so a 60 Hz display never lands on a switch; sampled
  with the old easing). Measured frame by frame at 60 Hz with rotation frozen, the shape is within
  0.002 px of the old continuous change and changes on the same frames. Starburst keeps its own
  `clip-path` keyframes: Chromium composites clip-path animations, and as a Web Animation it ran
  with no main-thread frames and cost less than a 67-copy flipbook (lab, renderer compositor
  49–65 vs 75 ms/s, viz 26–35 vs 89 ms/s). Rolling time digits slide by `transform` instead of
  `margin-top`, in whole-pixel steps (`round()`), so they rest exactly where `margin-top` put them.
- **Animations run as Web Animations** (`runOnCompositor()` in `client/web.ts`). Paseo's React
  root listens for `animationiteration`; while anything listens, Chromium wakes the main thread
  for each running CSS animation (lab probe: one 250 ms CSS animation = 20 main frames/s; the same
  animation as a Web Animation = 0.1/s). The CSS stays the single description: once a spinner, sheen or
  typed caret is laid out, its CSS animations are copied (keyframes, per-keyframe easing,
  duration, delay, pseudo-element) into `element.animate()` and switched off with
  `data-spn-waapi`. A ResizeObserver pauses them while the element has no box (a hidden panel:
  a Web Animation on a `display: none` element is ticked on the main thread every frame) and
  cancels them once it leaves the page; a reduced-motion switch re-copies them with the new
  durations. No IntersectionObserver anywhere: one active observation turns every composited
  frame into a main-thread frame.
- `client/web.test.ts` checks that the injected CSS animates and transitions nothing but
  `transform` and `opacity` (and starburst's `clip-path`), and the Web Animation lifecycle (copied
  on layout, paused while hidden, cancelled when the footer goes, re-timed on a reduced-motion
  switch); `client/catalog.test.ts` that the morph flipbook and the depth swaps show exactly one
  copy at every moment and switch only between 60 Hz frames.

Lab (Paseo 0.12 lab daemon, headless Chromium 150 on the RTX 3060, scenario S2 = turn running in
view, Paseo's own loader loop ablated so the plugin's frames show; main-thread frames/s, 386a050c →
now): plain time 15 → 1.6 (typing dots alone: their 3 CSS animations woke the main thread); shimmer
time 60 → 2.6; live shimmer 60 → 1.6; warming 60 (1–5 min) / 32 (colour ramp) → 1.6; morph
60 → 1.7 (renderer main 150 → 14 ms/s); starburst 3.7 → 1.6. Floor with nothing animated: 1.6.
Option sweep: every option composited, or (pseudo-element targets the sweep cannot inspect) at
the 1.6 floor. Visual: old vs new frames at the same animation times (24 per option, DPR 1 and 4)
are pixel-identical for 22 of 25 spinners, rolling time and warming; moon phases, atom and morph
differ only in edge antialiasing (at most 2.6 % of a 14 px tile's pixels by more than 32/255), the
sheens in text-edge antialiasing (≤ 1 %).

## Limits

- Depends on Paseo 0.12's test IDs and footer layout (`turn-working-indicator`, `turn-working-elapsed`,
  `agent-chat-scroll`, `data-history-row-id`, `tool-call-badge`). If an upgrade changes them, the
  footer falls back to Paseo's own look; nothing breaks.
- Live activity: very fast tools (about 200 ms) only show as the label that follows them; in Paseo's
  "Overview" tool display it shows the group summary ("Read 3 files, ran 2 commands"). Codex reads
  files through the shell, so it shows "Running cat".
- Warming colours are fixed amber/red tones (dark and light variants), not theme tokens.

## Live proof (2026-10-20, Paseo 0.12.0 daemon + app.paseo.sh, dark theme)

Installed from this folder; tested on a real running OMP turn in the web app:

- Defaults: Paseo's loader hidden, our smooth grid in its place (14 px), elapsed time shimmering.
- Picking tiles in the settings screen updated the running turn's footer immediately: Jelly dots +
  Icon label ("Running code" with omp's Eval icon) + Rolling time; then Orbit + Typed + Warming
  (amber at 12 min).
- `paseo plugin disable` removed every added element and style live (Paseo's dots back);
  `enable` restored ours. Settings were set back to the defaults afterwards.

