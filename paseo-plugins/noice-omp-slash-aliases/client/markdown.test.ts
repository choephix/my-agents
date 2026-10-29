import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, plainText } from "./markdown";

describe("parseInline", () => {
  it("styles bold, italic, strike and code runs", () => {
    expect(parseInline("a **b** *c* ~~d~~ `e*f*`")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " " },
      { text: "c", italic: true },
      { text: " " },
      { text: "d", strike: true },
      { text: " " },
      { text: "e*f*", code: true },
    ]);
  });

  it("nests italic inside bold", () => {
    expect(parseInline("**x _y_ z**")).toEqual([
      { text: "x ", bold: true },
      { text: "y", bold: true, italic: true },
      { text: " z", bold: true },
    ]);
  });

  it("keeps snake_case, lone stars and unclosed runs literal", () => {
    expect(parseInline("run_test_case with 2 * 3 and **open")).toEqual([
      { text: "run_test_case with 2 * 3 and **open" },
    ]);
  });

  it("links labelled and bare URLs, trimming sentence punctuation", () => {
    expect(parseInline("see [docs](https://x.dev/a) or https://y.dev/b.")).toEqual([
      { text: "see " },
      { text: "docs", url: "https://x.dev/a" },
      { text: " or " },
      { text: "https://y.dev/b", url: "https://y.dev/b" },
      { text: "." },
    ]);
  });

  it("does not end a bold run at a star inside a code span", () => {
    expect(parseInline("**use `a**b` here**")).toEqual([
      { text: "use ", bold: true },
      { text: "a**b", bold: true, code: true },
      { text: " here", bold: true },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("splits headings, paragraphs, lists, quotes and rules", () => {
    const blocks = parseMarkdown(
      "# Title\n\nfirst line\nsame paragraph\n\n- one\n  - nested\n2) two\n\n> quoted\n> more\n\n---",
    );
    expect(blocks).toEqual([
      { type: "heading", level: 1, spans: [{ text: "Title" }] },
      { type: "paragraph", spans: [{ text: "first line same paragraph" }] },
      { type: "item", marker: "•", depth: 0, spans: [{ text: "one" }] },
      { type: "item", marker: "•", depth: 1, spans: [{ text: "nested" }] },
      { type: "item", marker: "2.", depth: 0, spans: [{ text: "two" }] },
      { type: "quote", spans: [{ text: "quoted more" }] },
      { type: "rule" },
    ]);
  });

  it("keeps fenced code verbatim, including Markdown-looking lines", () => {
    expect(parseMarkdown("```ts\n# not a heading\n  - not a list\n```\nafter")).toEqual([
      { type: "code", text: "# not a heading\n  - not a list" },
      { type: "paragraph", spans: [{ text: "after" }] },
    ]);
  });

  it("treats an unterminated fence as code to the end", () => {
    expect(parseMarkdown("```\npartial streaming code")).toEqual([{ type: "code", text: "partial streaming code" }]);
  });

  it("parses pipe tables with inline cells", () => {
    expect(parseMarkdown("| Name | Value |\n|---|:-:|\n| a | **b** |\n| c | d |\ntext")).toEqual([
      {
        type: "table",
        header: [[{ text: "Name" }], [{ text: "Value" }]],
        rows: [
          [[{ text: "a" }], [{ text: "b", bold: true }]],
          [[{ text: "c" }], [{ text: "d" }]],
        ],
      },
      { type: "paragraph", spans: [{ text: "text" }] },
    ]);
  });

  it("joins an indented continuation line into the list item", () => {
    expect(parseMarkdown("- long item\n  wraps here")).toEqual([
      { type: "item", marker: "•", depth: 0, spans: [{ text: "long item wraps here" }] },
    ]);
  });
});

describe("plainText", () => {
  it("flattens Markdown into one preview line", () => {
    expect(plainText("## Plan\n\n1. Parse **EXIF**\n2. Rename\n\n```toml\nclap = \"4\"\n```\nDone `now`.")).toBe(
      'Plan 1. Parse EXIF 2. Rename clap = "4" Done now.',
    );
  });
});
