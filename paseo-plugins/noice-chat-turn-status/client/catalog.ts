import type { SpinnerId } from "../shared/preferences";

// Every animation is plain CSS sized in em: 1em is the spinner box (14px in Paseo's turn footer).
// Colours come from currentColor and three variables the host element sets:
// --spn-fg (Paseo's foreground), --spn-muted (the elapsed-time grey), --spn-bg (the surface behind).
// Class and keyframe names all start with "spn-" so they never collide with Paseo or other plugins.

const pct = (k: number, n: number) => `${((k * 100) / n).toFixed(2)}%`;
const f3 = (v: number) => v.toFixed(3);

/** Keyframes sampled around a full turn: fn gets the angle and returns the declarations. */
function loop(name: string, steps: number, fn: (angle: number) => string): string {
  const frames = Array.from({ length: steps + 1 }, (_, k) => `${pct(k, steps)}{${fn((2 * Math.PI * k) / steps)}}`);
  return `@keyframes ${name}{${frames.join("")}}`;
}

/** A clip-path polygon with points spread round the centre; radius(index) is 0–1 of the half-size. */
function polygon(points: number, radius: (index: number) => number): string {
  return `polygon(${Array.from({ length: points }, (_, j) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * j) / points, r = radius(j);
    return `${(50 + 50 * r * Math.cos(theta)).toFixed(2)}% ${(50 + 50 * r * Math.sin(theta)).toFixed(2)}%`;
  }).join(",")})`;
}

/** How near an orbiting body is (0 far, 1 near) at an angle of its loop. */
const nearness = (angle: number) => (Math.sin(angle) + 1) / 2;

/**
 * A body that passes behind and in front of another is two copies, one stacked below it and one
 * above, each shown by a step-end opacity animation: name-b while the loop is on the far side,
 * name-f while near (nearness > 0.5 at the loop's samples). The switch lands where a z-index
 * keyframe would flip, halfway between two samples. Opacity keeps it on the compositor; z-index
 * would put the whole animation on the main thread.
 */
function depthSwap(name: string, steps: number): string {
  const near = (k: number) => nearness((2 * Math.PI * k) / steps) > 0.5;
  const frames = (shown: boolean) => {
    let out = `0%{opacity:${near(0) === shown ? 1 : 0}}`;
    for (let k = 0; k < steps; k++) if (near(k) !== near(k + 1)) out += `${pct(k + 0.5, steps)}{opacity:${near(k + 1) === shown ? 1 : 0}}`;
    return `${out}100%{opacity:${near(steps) === shown ? 1 : 0}}`;
  };
  return `@keyframes ${name}-f{${frames(true)}}@keyframes ${name}-b{${frames(false)}}`;
}

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of input progress 0–1. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const curve = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  return (x) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) {
      const t = (lo + hi) / 2;
      if (curve(x1, x2, t) < x) lo = t;
      else hi = t;
    }
    return curve(y1, y2, (lo + hi) / 2);
  };
}

/**
 * A shape change only the main thread can animate (border-radius, clip-path) as a flipbook: one
 * pre-drawn copy of the shape per display frame, each switched on for its frame and off again by a
 * step-end opacity animation, so exactly one copy is visible at any time. The cycle has `frames`
 * slots; slot k shows the shape at k/frames of the cycle and is centred on that moment, so a
 * display whose frames land on those moments (60 Hz for a cycle of `frames` × 16.7 ms, as the
 * animation starts on a frame) shows each shape for one whole frame and never lands on a switch.
 * The shape goes out and back with one symmetric easing (keyframes 0% → 50% → 100%, as in the CSS
 * this replaces), so slots k and frames−k show the same shape and share a copy: frames/2 + 1
 * copies. `shape` gets the eased progress (0 at the 0% keyframe, 1 at the 50% one) and returns
 * that copy's declarations.
 */
function flipbook(name: string, copies: string, frames: number, ease: (x: number) => number, shape: (p: number) => string): string {
  const half = frames / 2;
  let css = "";
  for (let j = 0; j <= half; j++) {
    const on = (k: number) => `${pct(k - 0.5, frames)}{opacity:1}${pct(k + 0.5, frames)}{opacity:0}`;
    const keys = j === 0 ? `0%{opacity:1}${pct(0.5, frames)}{opacity:0}${pct(frames - 0.5, frames)}{opacity:1}100%{opacity:1}`
      : `0%{opacity:0}${on(j)}${j < half ? on(frames - j) : ""}100%{opacity:0}`;
    css += `@keyframes ${name}${j}{${keys}}${copies}:nth-child(${j + 1}){${shape(ease(j / half))};animation-name:${name}${j}}`;
  }
  return css;
}

/** Flipbook slots per cycle: one per 60 Hz frame (1.6 s). */
const MORPH_FRAMES = 96;

function generated(): string {
  let css = "";
  // Paseo's own 2×3 grid (app synced-loader-state.ts): the same six opacity frames over 950 ms,
  // but faded linearly between frames instead of stepping.
  const states = [[1, 0, 0.78, 0, 0.56, 0.34], [0.78, 1, 0.56, 0, 0.34, 0], [0.56, 0.78, 0.34, 1, 0, 0],
    [0.34, 0.56, 0, 0.78, 0, 1], [0, 0.34, 0, 0.56, 1, 0.78], [0, 0, 1, 0.34, 0.78, 0.56]];
  for (let dot = 0; dot < 6; dot++) {
    const frames = states.map((s, i) => `${pct(i, 6)}{opacity:${s[dot]}}`).join("");
    css += `@keyframes spn-grid${dot}{${frames}100%{opacity:${states[0]![dot]}}}`;
    css += `.spn-grid6 i:nth-child(${dot + 1}){animation:spn-grid${dot} .95s linear infinite}`;
  }
  // Braille trail and snake: a light runs clockwise round the cell; centre of the snake stays dim.
  [0, 1, 3, 5, 7, 6, 4, 2].forEach((cell, k) => { css += `.spn-btrail i:nth-child(${cell + 1}){animation-delay:${(-0.8 + k * 0.1).toFixed(2)}s}`; });
  [0, 1, 2, 5, 8, 7, 6, 3].forEach((cell, k) => { css += `.spn-snake i:nth-child(${cell + 1}){animation-delay:${f3(-1 + k * 0.125)}s}`; });
  for (let c = 0; c < 9; c++) css += `.spn-ripple i:nth-child(${c + 1}){animation-delay:${(-1.3 + (Math.floor(c / 3) + (c % 3)) * 0.12).toFixed(2)}s}`;
  // Orbits with depth: the far side of the path is smaller, dimmer, or behind.
  // Binary pair: both dots are the same colour, so which one is drawn on top never shows.
  css += loop("spn-pair", 24, (a) => `transform:translateX(${f3(0.32 * Math.cos(a))}em) scale(${f3(0.6 + 0.4 * nearness(a))});opacity:${f3(0.4 + 0.6 * nearness(a))}`);
  css += loop("spn-moon", 36, (a) => `transform:translate(${f3(0.42 * Math.cos(a))}em,${f3(0.1 * Math.sin(a))}em) scale(${f3(0.6 + 0.5 * nearness(a))})`);
  css += loop("spn-elec", 36, (a) => `transform:translate(${f3(0.46 * Math.cos(a))}em,${f3(0.17 * Math.sin(a))}em) scale(${f3(0.75 + 0.35 * nearness(a))})`);
  css += depthSwap("spn-moon", 36) + depthSwap("spn-elec", 36);
  // Morph: a rounded square that turns into a circle and back while it spins.
  css += flipbook("spn-morph", ".spn-morph b i", MORPH_FRAMES, cubicBezier(0.42, 0, 0.58, 1),
    (p) => `border-radius:calc(${f3(0.08 * (1 - p))}em + ${(50 * p).toFixed(2)}%)`);
  // Starburst: 24 points, alternating radii; the inner ones pull in and out.
  const burst = (inner: number) => polygon(24, (j) => (j % 2 ? inner : 1));
  css += `@keyframes spn-burst{0%{clip-path:${burst(0.92)};transform:rotate(0) scale(.7)}50%{clip-path:${burst(0.36)};transform:rotate(90deg) scale(1)}100%{clip-path:${burst(0.92)};transform:rotate(180deg) scale(.7)}}`;
  // Sliding tiles: the empty corner travels clockwise; 12 moves bring every tile home.
  const corners = [[0, 0], [0.6, 0], [0.6, 0.6], [0, 0.6]] as const;
  const at = [0, 1, 2];
  const frames: string[][] = [[], [], []];
  let gap = 3;
  const put = (tile: number, p: number, corner: number, ease: string) =>
    frames[tile]!.push(`${p.toFixed(3)}%{transform:translate(${corners[corner]![0]}em,${corners[corner]![1]}em);animation-timing-function:${ease}}`);
  for (let move = 0; move < 12; move++) {
    const mover = at.indexOf((gap + 1) % 4);
    at.forEach((corner, tile) => put(tile, (move * 100) / 12, corner, tile === mover ? "cubic-bezier(.65,0,.35,1)" : "linear"));
    at[mover] = gap;
    gap = (gap + 1) % 4;
    put(mover, ((move + 0.55) * 100) / 12, at[mover]!, "linear");
  }
  at.forEach((corner, tile) => put(tile, 100, corner, "linear"));
  frames.forEach((f, tile) => { css += `@keyframes spn-tile${tile}{${f.join("")}}.spn-tiles i:nth-child(${tile + 1}){animation:spn-tile${tile} 3.6s infinite}`; });
  return css;
}

const STATIC_CSS = `
.spn { width: 1em; height: 1em; position: relative; display: inline-block; flex: none; vertical-align: middle; }
.spn.spn-wide { width: 1.5em; }
.spn i, .spn b { display: block; }
.spn-star { position: absolute; background: currentColor;
  clip-path: polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%); }
@keyframes spn-spin { to { transform: rotate(1turn); } }

.spn-grid6 { display: grid; grid-template-columns: repeat(2, .26em); grid-auto-rows: .26em; gap: .12em; width: auto; height: auto; padding: 0 .19em; }
.spn-grid6 i { border-radius: 50%; background: currentColor; }

.spn-wave { display: inline-flex; align-items: center; justify-content: center; gap: .1em; width: 1.15em; }
.spn-wave i { width: .24em; height: .24em; border-radius: 50%; background: currentColor; animation: spn-wave 1.1s ease-in-out infinite; }
.spn-wave i:nth-child(2) { animation-delay: .15s } .spn-wave i:nth-child(3) { animation-delay: .3s }
@keyframes spn-wave { 0%,60%,100% { transform: translateY(.1em); opacity: .4 } 30% { transform: translateY(-.16em); opacity: 1 } }

.spn-bubble { width: 1.75em; border-radius: .5em; display: inline-flex; align-items: center; justify-content: center; gap: .13em;
  background: color-mix(in srgb, currentColor 14%, transparent); }
.spn-bubble i { width: .2em; height: .2em; border-radius: 50%; background: currentColor; animation: spn-soft 1.2s ease-in-out infinite; }
.spn-bubble i:nth-child(2) { animation-delay: .2s } .spn-bubble i:nth-child(3) { animation-delay: .4s }
@keyframes spn-soft { 0%,70%,100% { transform: scale(.7); opacity: .35 } 35% { transform: scale(1.1); opacity: 1 } }

.spn-jelly { display: inline-flex; align-items: flex-end; justify-content: center; gap: .1em; width: 1.2em; padding-bottom: .22em; box-sizing: border-box; }
.spn-jelly i { width: .26em; height: .26em; border-radius: 50%; background: currentColor; transform-origin: 50% 100%; animation: spn-jelly 1.2s infinite; }
.spn-jelly i:nth-child(2) { animation-delay: .14s } .spn-jelly i:nth-child(3) { animation-delay: .28s }
@keyframes spn-jelly {
  0% { transform: translateY(0) scale(1.3, .7); animation-timing-function: cubic-bezier(.2, .7, .4, 1) }
  18% { transform: translateY(-.34em) scale(.9, 1.12); animation-timing-function: cubic-bezier(.6, 0, .8, .4) }
  36% { transform: translateY(0) scale(1.3, .7) } 46%,100% { transform: translateY(0) scale(1) } }

.spn-words { display: inline-flex; align-items: center; gap: .09em; width: 1.4em; }
.spn-words i { height: .16em; border-radius: .08em; background: currentColor; transform-origin: 0 50%; }
.spn-words i:nth-child(1) { width: .34em; animation: spn-w1 2s infinite; }
.spn-words i:nth-child(2) { width: .5em; animation: spn-w2 2s infinite; }
.spn-words i:nth-child(3) { width: .26em; animation: spn-w3 2s infinite; }
@keyframes spn-w1 { 0% { transform: scaleX(0); opacity: 1 } 12%,82% { transform: scaleX(1); opacity: 1 } 95%,100% { transform: scaleX(1); opacity: 0 } }
@keyframes spn-w2 { 0%,18% { transform: scaleX(0); opacity: 1 } 34%,82% { transform: scaleX(1); opacity: 1 } 95%,100% { transform: scaleX(1); opacity: 0 } }
@keyframes spn-w3 { 0%,40% { transform: scaleX(0); opacity: 1 } 50%,82% { transform: scaleX(1); opacity: 1 } 95%,100% { transform: scaleX(1); opacity: 0 } }

.spn-orbit { border-radius: 50%; box-shadow: inset 0 0 0 max(1px, .05em) color-mix(in srgb, currentColor 16%, transparent); }
.spn-orbit::before { content: ""; position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 0deg, transparent 0 55%, currentColor 100%);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - .09em), #000 calc(100% - .08em));
          mask: radial-gradient(farthest-side, transparent calc(100% - .09em), #000 calc(100% - .08em));
  animation: spn-spin 1.3s cubic-bezier(.5, .15, .5, .85) infinite; }
.spn-orbit::after, .spn-twin b i { content: ""; position: absolute; width: .2em; height: .2em; left: calc(50% - .1em); top: -.055em;
  border-radius: 50%; background: currentColor; box-shadow: 0 0 .12em currentColor;
  transform-origin: .1em .555em; animation: spn-spin 1.3s cubic-bezier(.5, .15, .5, .85) infinite; }
.spn-twin::before { background: conic-gradient(from 0deg, transparent 0 25%, currentColor 50%, transparent 50% 75%, currentColor 100%); }
.spn-twin b { position: absolute; inset: 0; transform: rotate(180deg); }

.spn-comet { border-radius: 50%; background: conic-gradient(from 0deg, transparent 0 15%, currentColor 100%);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - .14em), #000 calc(100% - .13em));
          mask: radial-gradient(farthest-side, transparent calc(100% - .14em), #000 calc(100% - .13em));
  animation: spn-spin .9s linear infinite; }

.spn-pair i { position: absolute; left: calc(50% - .14em); top: calc(50% - .14em); width: .28em; height: .28em; border-radius: 50%;
  background: currentColor; animation: spn-pair 1.4s linear infinite; }
.spn-pair i + i { animation-delay: -.7s; }

.spn-atom .orb { position: absolute; inset: 0; transform: rotate(-25deg); }
.spn-atom .orb::before { content: ""; position: absolute; left: .02em; right: .02em; top: calc(50% - .19em); height: .38em;
  border-radius: 50%; border: max(1.3px, .085em) solid currentColor; opacity: .45; box-sizing: border-box; }
/* The electron is two copies: one under the nucleus (the far side of its orbit), one over it. */
.spn-atom .orb i { position: absolute; left: calc(50% - .12em); top: calc(50% - .12em); width: .24em; height: .24em;
  border-radius: 50%; background: currentColor; z-index: 1; animation: spn-elec 1.3s linear infinite, spn-elec-b 1.3s step-end infinite; }
.spn-atom .orb i + i { z-index: 3; animation-name: spn-elec, spn-elec-f; }
.spn-atom .nuc { position: absolute; left: calc(50% - .17em); top: calc(50% - .17em); width: .34em; height: .34em; border-radius: 50%;
  background: currentColor; z-index: 2; box-shadow: 0 0 0 .06em var(--spn-bg, transparent); }

.spn-eclipse i { position: absolute; border-radius: 50%; background: currentColor; }
.spn-eclipse i:nth-child(1) { left: calc(50% - .21em); top: calc(50% - .21em); width: .42em; height: .42em; z-index: 2;
  box-shadow: 0 0 0 .05em var(--spn-bg, transparent); }
/* The moon is two copies: one behind the planet (the far side of its orbit), one in front. */
.spn-eclipse i:nth-child(n + 2) { left: calc(50% - .09em); top: calc(50% - .09em); width: .18em; height: .18em; z-index: 1;
  animation: spn-moon 1.6s linear infinite, spn-moon-b 1.6s step-end infinite; }
.spn-eclipse i:nth-child(3) { z-index: 3; animation-name: spn-moon, spn-moon-f; }

/* Moon phases: a 3em-wide mask with a moon-sized hole slides across the moon. The mask sits still
   on its own element (b), which slides, while the moon inside it slides back by the same amount. */
.spn-phase::before { content: ""; position: absolute; inset: .15em; border-radius: 50%; border: max(1px, .05em) solid currentColor; opacity: .22; box-sizing: border-box; }
.spn-phase i { position: absolute; inset: .15em; }
.spn-phase i > b { position: absolute; left: 0; top: 0; width: 3em; height: 100%;
  -webkit-mask: radial-gradient(circle at 50% 50%, transparent .345em, #000 .36em) no-repeat;
          mask: radial-gradient(circle at 50% 50%, transparent .345em, #000 .36em) no-repeat;
  animation: spn-phase 3.2s ease-in-out infinite; }
.spn-phase i > b > b { position: absolute; left: 0; top: 0; width: .7em; height: 100%; border-radius: 50%; background: currentColor;
  animation: spn-phase-moon 3.2s ease-in-out infinite; }
@keyframes spn-phase { 0% { transform: translateX(-1.9em) } 50% { transform: translateX(-1.15em) } 100% { transform: translateX(-.4em) } }
@keyframes spn-phase-moon { 0% { transform: translateX(1.9em) } 50% { transform: translateX(1.15em) } 100% { transform: translateX(.4em) } }

/* Morph: b spins; the shape change inside is a flipbook (see flipbook()). */
.spn-morph b { position: absolute; inset: .2em; animation: spn-morph 1.6s ease-in-out infinite; }
.spn-morph b i { position: absolute; inset: 0; background: currentColor; opacity: 0; animation: 1.6s step-end infinite; }
@keyframes spn-morph { 0% { transform: rotate(0) scale(.85) } 50% { transform: rotate(180deg) scale(.6) } 100% { transform: rotate(360deg) scale(.85) } }
/* Starburst keeps its clip-path animation: Chromium runs clip-path animations on the compositor
   (lab, Chromium 150: no main-thread frames as a Web Animation, and cheaper than a 67-copy flipbook). */
.spn-burst::after { content: ""; position: absolute; inset: .04em; background: currentColor; animation: spn-burst 2.2s cubic-bezier(.6, 0, .4, 1) infinite; }

.spn-constel .spn-star { transform: scale(0); animation: spn-pop 2s ease-in-out infinite; }
.spn-constel .spn-star:nth-child(1) { left: .05em; top: .1em; width: .42em; height: .42em; animation-duration: 1.9s }
.spn-constel .spn-star:nth-child(2) { left: .55em; top: 0; width: .3em; height: .3em; animation-duration: 2.3s; animation-delay: .4s }
.spn-constel .spn-star:nth-child(3) { left: .62em; top: .5em; width: .38em; height: .38em; animation-duration: 1.7s; animation-delay: .9s }
.spn-constel .spn-star:nth-child(4) { left: .12em; top: .62em; width: .26em; height: .26em; animation-duration: 2.6s; animation-delay: 1.3s }
.spn-constel .spn-star:nth-child(5) { left: .38em; top: .34em; width: .22em; height: .22em; animation-duration: 2.1s; animation-delay: .2s }
@keyframes spn-pop { 0% { transform: scale(0) rotate(-45deg) } 30% { transform: scale(1) rotate(0) } 60%,100% { transform: scale(0) rotate(45deg) } }

/* Bounce: a ball over a soft shadow that shrinks as it rises; both share keyframe times and easings. */
.spn-bounce::before { content: ""; position: absolute; left: .26em; right: .26em; bottom: .01em; height: .1em; border-radius: 50%;
  background: currentColor; opacity: .35; animation: spn-shadow .9s infinite; }
.spn-bounce::after { content: ""; position: absolute; left: calc(50% - .17em); bottom: .08em; width: .34em; height: .34em;
  border-radius: 50%; background: currentColor; transform-origin: 50% 100%; animation: spn-bounce .9s infinite; }
@keyframes spn-bounce {
  0% { transform: translateY(0) scale(1.25, .75); animation-timing-function: cubic-bezier(.2, .7, .4, 1) }
  10% { transform: translateY(-.1em) scale(.9, 1.1); animation-timing-function: cubic-bezier(.2, .7, .4, 1) }
  50% { transform: translateY(-.55em) scale(1); animation-timing-function: cubic-bezier(.6, 0, .8, .3) }
  96% { transform: translateY(0) scale(.95, 1.05) } 100% { transform: translateY(0) scale(1.25, .75) } }
@keyframes spn-shadow {
  0% { transform: scaleX(1); opacity: .35; animation-timing-function: cubic-bezier(.2, .7, .4, 1) }
  10% { transform: scaleX(.92); opacity: .32; animation-timing-function: cubic-bezier(.2, .7, .4, 1) }
  50% { transform: scaleX(.45); opacity: .1; animation-timing-function: cubic-bezier(.6, 0, .8, .3) }
  96%, 100% { transform: scaleX(1); opacity: .35 } }

.spn-hbounce::before { content: ""; position: absolute; left: .1em; top: .17em; bottom: .17em; width: .06em; border-radius: .03em;
  background: currentColor; opacity: .25; }
.spn-hbounce i { position: absolute; left: .17em; top: calc(50% - .17em); width: .34em; height: .34em; border-radius: 50%;
  background: currentColor; transform-origin: 0 50%; animation: spn-hball .9s infinite; }
@keyframes spn-hball {
  0% { transform: translateX(0) scale(.75, 1.25); animation-timing-function: cubic-bezier(.2, .7, .4, 1) }
  10% { transform: translateX(.12em) scale(1.1, .9); animation-timing-function: cubic-bezier(.2, .7, .4, 1) }
  50% { transform: translateX(.9em) scale(1); animation-timing-function: cubic-bezier(.6, 0, .8, .3) }
  96% { transform: translateX(0) scale(1.05, .95) } 100% { transform: translateX(0) scale(.75, 1.25) } }

.spn-hop::before { content: ""; position: absolute; left: 0; right: 0; bottom: .1em; height: .05em; border-radius: .03em;
  background: currentColor; opacity: .22; }
.spn-hop b { position: absolute; left: calc(50% - .12em); bottom: .15em; animation: spn-hopx 2.4s linear infinite; }
.spn-hop b i { width: .24em; height: .24em; border-radius: 50%; background: currentColor; transform-origin: 50% 100%; animation: spn-hopy .4s infinite; }
@keyframes spn-hopx { 0% { transform: translateX(-.5em) } 50% { transform: translateX(.5em) } 100% { transform: translateX(-.5em) } }
@keyframes spn-hopy {
  0% { transform: translateY(0) scale(1.3, .7); animation-timing-function: cubic-bezier(.2, .7, .4, 1) }
  12% { transform: translateY(-.05em) scale(.9, 1.1); animation-timing-function: cubic-bezier(.2, .7, .4, 1) }
  50% { transform: translateY(-.42em) scale(1); animation-timing-function: cubic-bezier(.6, 0, .8, .3) }
  100% { transform: translateY(0) scale(1.3, .7) } }

.spn-cradle i { position: absolute; top: calc(50% - .15em); width: .3em; height: .3em; border-radius: 50%; background: currentColor; }
.spn-cradle i:nth-child(1) { left: calc(50% - .3em); animation: spn-cradA 1.2s infinite; }
.spn-cradle i:nth-child(2) { left: 50%; animation: spn-cradB 1.2s infinite; }
@keyframes spn-cradA { 0%,50% { transform: translateX(0); animation-timing-function: cubic-bezier(.2, .7, .4, 1) }
  75% { transform: translateX(-.36em); animation-timing-function: cubic-bezier(.6, 0, .8, .3) } 100% { transform: translateX(0) } }
@keyframes spn-cradB { 0% { transform: translateX(0); animation-timing-function: cubic-bezier(.2, .7, .4, 1) }
  25% { transform: translateX(.36em); animation-timing-function: cubic-bezier(.6, 0, .8, .3) } 50%,100% { transform: translateX(0) } }

.spn-btrail { display: grid; grid-template-columns: repeat(2, .2em); grid-auto-rows: .2em; gap: .07em .14em; width: auto; height: auto; padding: 0 .23em; }
.spn-btrail i, .spn-snake i.r { border-radius: 50%; background: currentColor; opacity: .12; animation: spn-trail .8s linear infinite; }
.spn-snake i.r { animation-duration: 1s; }
@keyframes spn-trail { 0% { opacity: 1 } 40% { opacity: .12 } 100% { opacity: .12 } }
.spn-snake { display: grid; grid-template-columns: repeat(3, .22em); grid-auto-rows: .22em; gap: .17em; width: auto; height: auto; padding: .01em; }
.spn-snake i { border-radius: 50%; background: currentColor; opacity: .14; }

.spn-tri { animation: spn-tri 1.5s cubic-bezier(.65, 0, .35, 1) infinite; }
.spn-tri i { position: absolute; width: .26em; height: .26em; border-radius: 50%; background: currentColor; }
.spn-tri i:nth-child(1) { left: .37em; top: .04em } .spn-tri i:nth-child(2) { left: .06em; top: .6em; opacity: .6 }
.spn-tri i:nth-child(3) { left: .68em; top: .6em; opacity: .3 }
@keyframes spn-tri { 0%,20% { transform: rotate(0) } 33.3%,53.3% { transform: rotate(120deg) } 66.6%,86.6% { transform: rotate(240deg) } 100% { transform: rotate(360deg) } }

.spn-tiles i { position: absolute; width: .4em; height: .4em; border-radius: .07em; background: currentColor; left: 0; top: 0; }
.spn-tiles i:nth-child(2) { opacity: .7 } .spn-tiles i:nth-child(3) { opacity: .45 }

.spn-ripple { display: grid; grid-template-columns: repeat(3, .24em); grid-auto-rows: .24em; gap: .14em; width: auto; height: auto; }
.spn-ripple i { border-radius: 50%; background: currentColor; animation: spn-swell 1.3s ease-in-out infinite; }
@keyframes spn-swell { 0%,70%,100% { transform: scale(.45); opacity: .35 } 35% { transform: scale(1); opacity: 1 } }

.spn-flip { perspective: 3em; }
.spn-flip::after { content: ""; position: absolute; inset: .18em; border-radius: .08em; background: currentColor; animation: spn-flip 1.6s ease-in-out infinite; }
@keyframes spn-flip { 0% { transform: rotateX(0) rotateY(0) } 50% { transform: rotateX(180deg) rotateY(0) } 100% { transform: rotateX(180deg) rotateY(180deg) } }

/* ── Live activity label and elapsed time ──────────────────────────────────────────────── */
/* The sheen: the text stays muted and a bright copy of it (.c) shows through a window (.w) whose
   mask is the travelling band. The window slides right by two text widths while the copy inside
   slides left by the same amount, so the copy's glyphs sit exactly on the muted ones and only the
   band moves. Both are transform animations, which the compositor runs without the main thread;
   the static mask rides on the window's layer. Geometry matches the old background-clip:text
   gradient (100deg band, 300 % of the text's width, from -200 % to 0 over 1.8 s). */
.spn-sheen { position: relative; }
.spn-gl { position: absolute; inset: 0; overflow: hidden; pointer-events: none; container-type: inline-size; }
.spn-gl > .w { position: absolute; left: 0; top: 0; height: 100%; width: 300cqw;
  -webkit-mask: linear-gradient(100deg, transparent 0 35%, #000 50%, transparent 65% 100%);
          mask: linear-gradient(100deg, transparent 0 35%, #000 50%, transparent 65% 100%);
  animation: spn-gl-w 1.8s linear infinite; }
.spn-gl .c { position: absolute; left: 0; top: 0; height: 100%; width: 100cqw; color: var(--spn-fg); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; animation: spn-gl-c 1.8s linear infinite; }
@keyframes spn-gl-w { from { transform: translateX(calc(-200% / 3)) } to { transform: translateX(0) } }
@keyframes spn-gl-c { from { transform: translateX(200%) } to { transform: translateX(0) } }
.spn-live { display: inline-flex; align-items: center; white-space: nowrap; max-width: 42ch; overflow: hidden; flex: 0 1 auto;
  min-width: 0; color: var(--spn-fg); transition: opacity .25s; }
.spn-live.spn-fade { opacity: 0; }
.spn-live .t { overflow: hidden; text-overflow: ellipsis; }
.spn-live > .t.spn-sheen { color: var(--spn-muted); }
.spn-live.spn-roll-label { height: var(--spn-lh, 1.4em); line-height: var(--spn-lh, 1.4em); }
.spn-live.spn-roll-label > .t { display: inline-block; transition: transform .22s cubic-bezier(.3, 1.3, .5, 1), opacity .22s; }
.spn-live.spn-roll-label > .t.out { transform: translateY(-110%); opacity: 0; }
.spn-live.spn-roll-label > .t.pre { transform: translateY(110%); opacity: 0; transition: none; }
.spn-live.spn-typed > .t::after { content: ""; display: inline-block; width: 1px; height: 1.05em; margin-left: 1px; vertical-align: -.15em;
  background: currentColor; animation: spn-blink 1s steps(1) infinite; }
@keyframes spn-blink { 50% { opacity: 0 } }
/* Icon + label: one sheen over the whole label; its copy repeats the icon (a mask over a fill) and
   the text in the same flex layout, so one band sweeps both. */
.spn-live.spn-icon, .spn-icon .spn-gl .c { gap: .4em; }
.spn-icon .spn-gl .c { display: flex; align-items: center; }
.spn-icon .ico { width: 1.15em; height: 1.15em; flex: none; background: var(--spn-muted);
  -webkit-mask: var(--icon) center / contain no-repeat; mask: var(--icon) center / contain no-repeat; }
.spn-icon .c .ico { background: var(--spn-fg); }
.spn-icon > .t { color: var(--spn-muted); }
.spn-icon .ico:not([style*="--icon"]) { display: none; }

.spn-roll { display: inline-flex; white-space: pre; font-variant-numeric: tabular-nums; height: var(--spn-lh, 1.4em); line-height: var(--spn-lh, 1.4em); }
.spn-roll .col { display: inline-block; height: var(--spn-lh, 1.4em); overflow: hidden; }
.spn-roll .col > span { display: block; transition: transform .45s cubic-bezier(.3, 1.4, .5, 1); }
.spn-roll .col > span > b { display: block; height: round(var(--spn-lh, 1.4em), 1px); font-weight: inherit; }

@media (prefers-reduced-motion: reduce) {
  /* The footer's own elapsed-time sheen (.spn-stime) has always kept its speed here. */
  .spn, .spn *, .spn::before, .spn::after, .spn-sheen:not(.spn-stime) * { animation-duration: 3s !important; }
}
/* Copied into Web Animations (web.ts runOnCompositor): the CSS ones stop. */
[data-spn-waapi], [data-spn-waapi] *, [data-spn-waapi]::before, [data-spn-waapi]::after,
[data-spn-waapi] *::before, [data-spn-waapi] *::after { animation-name: none !important; }
`;

/** All CSS for spinners, live labels and time styles; inject once per document. */
export const CATALOG_CSS = STATIC_CSS + generated();

const dots = (n: number, cls = "") => `<i${cls ? ` class="${cls}"` : ""}></i>`.repeat(n);
const stars = (n: number) => `<i class="spn-star"></i>`.repeat(n);

/** Classes and inner markup of each spinner; the outer element is a span with class "spn". */
export const SPINNER_MARKUP: Record<Exclude<SpinnerId, "off">, { cls: string; html: string }> = {
  "paseo-smooth": { cls: "spn-grid6", html: dots(6) },
  "typing-dots": { cls: "spn-wave", html: dots(3) },
  "typing-bubble": { cls: "spn-bubble", html: dots(3) },
  "jelly-dots": { cls: "spn-jelly", html: dots(3) },
  words: { cls: "spn-words", html: dots(3) },
  orbit: { cls: "spn-orbit", html: "" },
  "twin-comets": { cls: "spn-orbit spn-twin", html: "<b><i></i></b>" },
  "comet-arc": { cls: "spn-comet", html: "" },
  "binary-pair": { cls: "spn-pair", html: dots(2) },
  atom: { cls: "spn-atom", html: `<b class="orb"><i></i><i></i><b class="nuc"></b></b>` },
  eclipse: { cls: "spn-eclipse", html: dots(3) },
  "moon-phases": { cls: "spn-phase", html: "<i><b><b></b></b></i>" },
  morph: { cls: "spn-morph", html: `<b>${dots(MORPH_FRAMES / 2 + 1)}</b>` },
  starburst: { cls: "spn-burst", html: "" },
  constellation: { cls: "spn-constel", html: stars(5) },
  bounce: { cls: "spn-bounce", html: "" },
  "sideways-bounce": { cls: "spn-hbounce spn-wide", html: dots(1) },
  "hop-across": { cls: "spn-hop spn-wide", html: "<b><i></i></b>" },
  cradle: { cls: "spn-cradle spn-wide", html: dots(2) },
  "braille-trail": { cls: "spn-btrail", html: dots(8) },
  snake: { cls: "spn-snake", html: Array.from({ length: 9 }, (_, i) => (i === 4 ? "<i></i>" : `<i class="r"></i>`)).join("") },
  "triangle-hop": { cls: "spn-tri", html: dots(3) },
  "sliding-tiles": { cls: "spn-tiles", html: dots(3) },
  "ripple-grid": { cls: "spn-ripple", html: dots(9) },
  "flip-tile": { cls: "spn-flip", html: "" },
};
