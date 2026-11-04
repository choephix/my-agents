# Paseo mock base

The kit for building fake Paseo screens to design plugins on, and the words
for what sits on such a page.

## The page

**Mock**:
The fake Paseo UI being designed, built from the starter's static copy of Paseo; not the controls around it, and never Stefan's real Paseo.
_Avoid_: Prototype, page, app

**Frame**:
The box one mock renders in, holding its own design; every frame on the page shares one situation, and all frames are equal; not the whole page.
_Avoid_: Screen, viewport, canvas, candidate, reference

**Selected frame**:
The one frame the design controls change, marked by its amber title and ring; clicking its title again selects the frame selected before it.
_Avoid_: Active frame, current, main frame, candidate

**Frame title**:
A frame's number and design name, over its frame (side by side) or in the tab strip (tabbed); clicking it selects the frame.
_Avoid_: Label, caption, tab (for the side-by-side title)

**Side by side / tabbed**:
The two ways to show the frames: all in a row, or only the selected one with the titles as tabs; a view choice, not a design and not a shell layout.
_Avoid_: Compare mode, split view

**Shell**:
Everything outside the frames: the design controls, the situation controls, the view controls and the backdrop; never part of the mock.
_Avoid_: Dev UI, workbench, chrome, toolbar

**Shell bars**:
The shell layout with design bars along the top and the situation bar along the bottom; the same controls as the shell sidebar.
_Avoid_: Toolbars, top bar (for the whole layout)

**Shell sidebar**:
The shell layout with all controls in one right-hand panel, view bar on top, design above situation; the same controls as the shell bars, not Paseo's own sidebar.
_Avoid_: Panel, settings panel, inspector

**View bar**:
The top-right corner group (Base, Notes, Sidebar): how you look at the mock, never what is decided or where it is seen.
_Avoid_: Review bar, toolbar

**Backdrop**:
The dotted (or checker, or plain) surface behind the frames; part of the shell, never inside a frame.
_Avoid_: Canvas, background

## Three groups of controls

Design (amber) is what is decided and acts on the selected frame only.
Situation (violet) is where it is seen and is shared by every frame. View
(neutral: the view bar and the frame titles) is how you are looking: which
frames exist, which one is selected, side by side or tabbed, Notes, the
shell layout. A control belongs to exactly one group. One exception, kept in
the view bar because it is used to look, not to decide: the Base toggle,
which turns the selected frame's design into Base.

## Design: what is decided

**Design**:
What is being decided, held per frame: variant picks, knob values (often from a preset) and Base; never theme, viewport, region, scale, data or app state.
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
Plain Paseo without any of the mock's changes; a design a frame can hold (toggled with Base in the view bar), not a situation.
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
