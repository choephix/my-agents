import { describe, expect, it } from "vitest";
import { isPlain, parseBlocks, parseInline, segment } from "./parse";
import { DEFAULTS, tagList } from "../shared/preferences";

const rules = { always: tagList(DEFAULTS.alwaysFold), never: tagList(DEFAULTS.neverFold) };
const folds = (text: string) => segment(text, rules).filter((part) => part.kind === "fold");

describe("fold rule", () => {
  it("folds a block tag with 2+ content lines and keeps the text around it", () => {
    const parts = segment("Look at this:\n<summary>\nline one\nline two\n</summary>\nThanks", rules);
    expect(parts.map((part) => part.kind)).toEqual(["text", "fold", "text"]);
    expect(parts[1]).toMatchObject({ tag: "summary", open: "<summary>", close: "</summary>", body: "line one\nline two" });
  });

  it("leaves one-line blocks, inline mentions and unclosed tags alone", () => {
    expect(folds("<summary>\nonly one\n</summary>")).toEqual([]);
    expect(folds("use <summary> here\nand\nthere </summary>")).toEqual([]);
    expect(folds("<summary>\na\nb\nno close")).toEqual([]);
  });

  it("always-fold tags fold even with one line, also on one source line", () => {
    expect(folds("<system-notice>\nBackground job bg_2 completed\n</system-notice>")).toHaveLength(1);
    expect(folds("<attachments>see file</attachments>")).toMatchObject([{ open: "<attachments>", close: "</attachments>", body: "see file" }]);
  });

  it("never-fold tags stay text however long", () => {
    expect(folds("<div>\na\nb\nc\n</div>")).toEqual([]);
  });

  it("does not fold inside code fences, and a fence inside a block does not end it", () => {
    expect(folds("```html\n<summary>\na\nb\n</summary>\n```")).toEqual([]);
    const [fold] = folds("<context>\n```\n</context>\n```\nafter\n</context>");
    expect(fold).toMatchObject({ body: "```\n</context>\n```\nafter" });
  });

  it("folds nested same-name tags as one outer block", () => {
    const text = "<context>\nouter\n<context>\ninner\nmore\n</context>\nend\n</context>\ntail";
    const parts = segment(text, rules);
    expect(parts.map((part) => part.kind)).toEqual(["fold", "text"]);
    expect(parts[0]).toMatchObject({ body: "outer\n<context>\ninner\nmore\n</context>\nend" });
  });

  it("keeps the opening tag with its attributes and both tags' casing verbatim", () => {
    expect(folds('  <File path="src/main.ts" lang=ts>\na\nb\n</file>  ')[0])
      .toMatchObject({ open: '<File path="src/main.ts" lang=ts>', close: "</file>" });
  });
});

describe("markdown", () => {
  it("keeps single newlines inside a paragraph and reports plain text as plain", () => {
    const blocks = parseBlocks("hello\nworld");
    expect(blocks).toEqual([{ t: "p", inline: [{ t: "text", text: "hello\nworld" }] }]);
    expect(isPlain(blocks)).toBe(true);
    expect(isPlain(parseBlocks("a **b**"))).toBe(false);
  });

  it("parses lists with nesting, fences with language, quotes and headings", () => {
    const blocks = parseBlocks("# Title\n- one\n  - sub\n- two\n\n```ts\nconst a = 1;\n```\n> quoted");
    expect(blocks.map((block) => block.t)).toEqual(["h", "list", "code", "quote"]);
    const list = blocks[1] as Extract<typeof blocks[number], { t: "list" }>;
    expect(list.items).toHaveLength(2);
    expect(list.items[0].map((block) => block.t)).toEqual(["p", "list"]);
    expect(blocks[2]).toEqual({ t: "code", lang: "ts", text: "const a = 1;" });
  });

  it("does not treat snake_case or a lone asterisk as emphasis; code spans stay literal", () => {
    expect(parseInline("my_var_name and 2 * 3")).toEqual([{ t: "text", text: "my_var_name and 2 * 3" }]);
    expect(parseInline("`**not bold**`")).toEqual([{ t: "code", text: "**not bold**" }]);
    expect(parseInline("see https://example.com/a.")).toEqual([
      { t: "text", text: "see " },
      { t: "link", href: "https://example.com/a", children: [{ t: "text", text: "https://example.com/a" }] },
      { t: "text", text: "." },
    ]);
  });
});
