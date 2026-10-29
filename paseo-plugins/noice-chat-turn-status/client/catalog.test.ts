import { describe, expect, test } from "vitest";
import { CATALOG_CSS, SPINNER_MARKUP } from "./catalog";

/** The keyframes of one @keyframes rule as [offset %, declarations] pairs. */
function keyframes(name: string): [number, string][] {
  const start = CATALOG_CSS.indexOf(`@keyframes ${name}{`);
  if (start < 0) throw new Error(`no @keyframes ${name}`);
  let depth = 0, end = start;
  for (let i = CATALOG_CSS.indexOf("{", start); i < CATALOG_CSS.length; i++) {
    if (CATALOG_CSS[i] === "{") depth++;
    else if (CATALOG_CSS[i] === "}" && --depth === 0) { end = i; break; }
  }
  const body = CATALOG_CSS.slice(CATALOG_CSS.indexOf("{", start) + 1, end);
  return [...body.matchAll(/([\d.%,\s]+)\{([^}]*)\}/g)].flatMap(([, offsets, declarations]) =>
    offsets!.split(",").map((offset) => [Number.parseFloat(offset), declarations!] as [number, string]));
}

/** Opacity at `t` % of a step-end animation: each keyframe's value holds until the next keyframe. */
function steppedOpacity(frames: [number, string][], t: number): number {
  let value = 0;
  for (const [offset, declarations] of frames) if (offset <= t) value = Number(/opacity:([\d.]+)/.exec(declarations)?.[1] ?? value);
  return value;
}

const copiesIn = (html: string) => html.match(/<i><\/i>/g)?.length ?? 0;
const SAMPLES = Array.from({ length: 10000 }, (_, k) => k / 100);

describe("flipbooks", () => {
  test.each([["morph", "spn-morph"]] as const)("%s shows exactly one copy at every moment, out and back", (id, name) => {
    const copies = copiesIn(SPINNER_MARKUP[id].html);
    const books = Array.from({ length: copies }, (_, j) => keyframes(`${name}${j}`));
    expect(CATALOG_CSS).not.toContain(`@keyframes ${name}${copies}{`);
    const slots = (copies - 1) * 2;
    // Slot k is centred on k/slots of the cycle; its ends as written in the CSS (two decimals).
    const ends = Array.from({ length: slots }, (_, k) => Number((((k + 0.5) * 100) / slots).toFixed(2)));
    for (const t of SAMPLES) {
      const shown = books.flatMap((book, j) => (steppedOpacity(book, t) === 1 ? [j] : []));
      // Slots k and slots-k show the same shape and share a copy.
      const slot = ends.filter((end) => end <= t).length % slots;
      expect({ t, shown }).toEqual({ t, shown: [Math.min(slot, slots - slot)] });
    }
  });

  test.each([["morph", "spn-morph", 1600]] as const)("%s switches copies only between 60 Hz frames", (id, name, cycle) => {
    const copies = copiesIn(SPINNER_MARKUP[id].html);
    const switches = Array.from({ length: copies }, (_, j) => keyframes(`${name}${j}`).map(([offset]) => (offset * cycle) / 100))
      .flat().filter((ms) => ms > 0 && ms < cycle);
    // A display frame at k × 16.67 ms from the start is never within 7 ms of a switch, so it never
    // shows a copy twice or skips one.
    for (let frame = 0; frame * (1000 / 60) < cycle; frame++) {
      const nearest = Math.min(...switches.map((ms) => Math.abs(ms - (frame * 1000) / 60)));
      expect({ frame, nearest: nearest > 7 }).toEqual({ frame, nearest: true });
    }
  });

  test("morph goes from the rounded square (0% keyframe) to the circle (50%), rounder with every copy", () => {
    const radii = Array.from({ length: copiesIn(SPINNER_MARKUP.morph.html) }, (_, j) => {
      const match = new RegExp(`\\.spn-morph b i:nth-child\\(${j + 1}\\)\\{border-radius:calc\\(([\\d.]+)em \\+ ([\\d.]+)%\\)`).exec(CATALOG_CSS);
      return [Number(match![1]), Number(match![2])] as const;
    });
    expect(radii[0]).toEqual([0.08, 0]);
    expect(radii.at(-1)).toEqual([0, 50]);
    for (let j = 1; j < radii.length; j++) expect(radii[j]![1]).toBeGreaterThan(radii[j - 1]![1]);
  });
});

describe("orbits behind and in front", () => {
  test.each(["spn-moon", "spn-elec"])("%s: exactly one of the two copies shows at every moment, the front one on the near half", (name) => {
    const front = keyframes(`${name}-f`), back = keyframes(`${name}-b`);
    for (const t of SAMPLES) expect(steppedOpacity(front, t) + steppedOpacity(back, t)).toBe(1);
    // The loop's near half is angles 0–180°: the first half of the cycle (sin > 0).
    expect(steppedOpacity(front, 25)).toBe(1);
    expect(steppedOpacity(back, 75)).toBe(1);
  });
});
