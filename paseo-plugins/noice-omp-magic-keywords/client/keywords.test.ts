import { describe, expect, it } from "vitest";
import { findClaudeUltrathink, findMagicKeywords, MAGIC_KEYWORDS, stopFor, STOPS } from "./keywords";

const ULTRATHINK = MAGIC_KEYWORDS.findIndex(({ word }) => word === "ultrathink");
const spans = (text: string, matches: { start: number; end: number }[]) => matches.map(({ start, end }) => text.slice(start, end));

// Claude Code decides with /\bultrathink\b/i on the raw prompt; OMP wants the exact lowercase word
// standing alone in prose. Each chat is coloured by the rule its own agent applies.
describe("findClaudeUltrathink", () => {
  it.each([
    ["Ultrathink about this", ["Ultrathink"]],
    ["use `ultrathink` here", ["ultrathink"]],
    ["foo.ultrathink bar", ["ultrathink"]],
    ["<paseo-system>ultrathink</paseo-system>", ["ultrathink"]],
  ])("colours %j, which Claude acts on and OMP ignores", (text, expected) => {
    expect(spans(text, findClaudeUltrathink(text))).toEqual(expected);
    expect(findMagicKeywords(text).filter(({ keyword }) => keyword === ULTRATHINK)).toEqual([]);
  });

  it("leaves words Claude ignores plain, as OMP does", () => {
    for (const text of ["ultrathinking", "ultra think", "ultrathink_now"]) {
      expect(findClaudeUltrathink(text)).toEqual([]);
      expect(findMagicKeywords(text)).toEqual([]);
    }
  });

  it("reports every hit as the ultrathink keyword", () => {
    const text = "ultrathink, then ULTRATHINK";
    expect(findClaudeUltrathink(text)).toEqual([
      { keyword: ULTRATHINK, start: 0, end: 10 },
      { keyword: ULTRATHINK, start: 17, end: 27 },
    ]);
  });
});

// Unclosed tags are rejected from an index of each tag name's last `</name` instead of a scan to the
// end. The shortcut must give the same answer as the scan, including when a close exists after the tag,
// when the only close sits before it, and when lowercasing shifts indices.
describe("findMagicKeywords with unclosed tags", () => {
  it("still masks a tag whose close comes later in the text", () => {
    expect(spans("<note>ultrathink</note> orchestrate", findMagicKeywords("<note>ultrathink</note> orchestrate"))).toEqual(["orchestrate"]);
    expect(spans("<a><b>ultrathink</b> jevify", findMagicKeywords("<a><b>ultrathink</b> jevify"))).toEqual(["jevify"]);
  });

  it("treats a tag as literal when its only close sits before it", () => {
    const text = "</note> <note>ultrathink";
    expect(spans(text, findMagicKeywords(text))).toEqual(["ultrathink"]);
  });

  it("keeps masking right when a letter lowercases to more code units", () => {
    // İ (U+0130) lowercases to two code units, so indices into the lowercased copy would drift.
    const text = "İİİ <i>ultrathink</i> workflowz";
    expect(spans(text, findMagicKeywords(text))).toEqual(["workflowz"]);
  });

  it("stays linear on pasted generics that never close", () => {
    // 150 KB: the scan-to-the-end version took about 0.7 s here, the indexed one about 3 ms.
    const code = "const m = new Map<string, number>(); const p: Promise<void> = x;\n".repeat(2400) + "ultrathink";
    const started = performance.now();
    expect(spans(code, findMagicKeywords(code))).toEqual(["ultrathink"]);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("stopFor", () => {
  it("steps every glyph through consecutive stops as the shift advances, skipping none", () => {
    for (const length of [1, 6, 9, 10, 11]) {
      for (let index = 0; index < length; index++) {
        for (let shift = 0; shift < STOPS; shift++) {
          expect(stopFor(index, length, (shift + 1) % STOPS)).toBe((stopFor(index, length, shift) + 1) % STOPS);
        }
      }
    }
  });
});
