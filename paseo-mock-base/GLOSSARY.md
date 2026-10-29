# Paseo mock base

The kit for building fake Paseo screens to design plugins on, and the words
for what sits on such a page.

## The page

**Mock**:
The fake Paseo UI being designed, built from the starter's static copy of Paseo; not the controls around it, and never Stefan's real Paseo.
_Avoid_: Prototype, page, app

**Frame**:
The box one mock renders in, one per compared design, all sharing one situation; not the whole page.
_Avoid_: Screen, viewport, canvas

**Candidate**:
The frame that follows the design controls, always next to them (rightmost); not a fixed preset.
_Avoid_: Main frame, current

**Reference**:
A frame showing Base, a preset or a variant beside the candidate, in the same situation; not a second candidate and not a screenshot.
_Avoid_: Comparison, baseline frame, before

**Shell**:
Everything outside the frames: the design controls, the situation controls and the backdrop; never part of the mock.
_Avoid_: Dev UI, workbench, chrome, toolbar

**Shell bars**:
The shell layout with design bars along the top and the situation bar along the bottom; the same controls as the shell sidebar.
_Avoid_: Toolbars, top bar (for the whole layout)

**Shell sidebar**:
The shell layout with all controls in one right-hand panel, design above situation; the same controls as the shell bars, not Paseo's own sidebar.
_Avoid_: Panel, settings panel, inspector

**Backdrop**:
The dotted (or checker, or plain) surface behind the frames; part of the shell, never inside a frame.
_Avoid_: Canvas, background

## Design: what is decided

**Design**:
What is being decided: the section's variant, knob values and presets; never theme, viewport, region, scale, data or app state.
_Avoid_: Options, config, settings

**Section**:
One top-level screen of a mock with its own variants, such as Chat or Settings; not a region.
_Avoid_: Page, tab, screen

**Variant**:
One discrete design option of a section, named by a letter (A, B, C); not a knob value.
_Avoid_: Option, version, alternative

**Knob**:
One continuous or small-choice setting within the chosen design (a size, an opacity, a colour, a mode); design, not situation.
_Avoid_: Tweak, slider, parameter, setting

**Preset**:
A named bundle of knob values, optionally with a variant, such as "Today · Regular"; not a variant and not a saved situation.
_Avoid_: Profile, snapshot, theme

**Base**:
Plain Paseo without any of the mock's changes; a design state, not a situation.
_Avoid_: Original, before, current Paseo

## Situation: where it is seen

**Situation**:
Where the design is seen: theme, viewport, region, scale, data and app state; it never changes the design.
_Avoid_: Context, environment, settings

**Region**:
The part of Paseo a frame shows (whole screen, sidebar, composer, …), cut out at its real size; not a section.
_Avoid_: Crop, zoom area, component

**Scale**:
How big a frame is drawn: fit the window, true size (1:1), or a whole-number magnification; never the mock's own sizes.
_Avoid_: Zoom (for fit), size

**App state**:
A situation axis of the mock, such as panel open or session empty; not a variant.
_Avoid_: Mode, scenario
