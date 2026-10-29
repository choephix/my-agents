import { describe, expect, it } from "vitest";
import { isDiffBlock, parseDiff } from "./model";

describe("isDiffBlock", () => {
  it("accepts labeled diff fences whatever their content", () => {
    expect(isDiffBlock("diff", "just prose")).toBe(true);
    expect(isDiffBlock("patch", "x")).toBe(true);
  });

  it("leaves fences labeled with another language alone, even with +/- lines", () => {
    expect(isDiffBlock("ts", "- const a = 1;\n+ const a = 2;")).toBe(false);
  });

  it("accepts unlabeled blocks with git structure or diff-shaped rows", () => {
    expect(isDiffBlock(null, "@@ -1,2 +1,2 @@\n a\n-b\n+c")).toBe(true);
    expect(isDiffBlock(null, "--- a/x.py\n+++ b/x.py\n x")).toBe(true);
    expect(isDiffBlock(null, "-    old,\n     same,\n+    new,")).toBe(true);
  });

  it("rejects unlabeled blocks that only start some lines with + or -", () => {
    // A column table from a real transcript: one row starts with "-", another with a letter.
    expect(isDiffBlock(null, "-skills   [skill]   + prompt\ndefault   [skill]   + prompt")).toBe(false);
    // Additions alone are a list, not a change.
    expect(isDiffBlock(null, "+ one\n+ two")).toBe(false);
  });
});

describe("parseDiff", () => {
  const kinds = (text: string) => parseDiff(text).lines.map((line) => line.kind);

  it("treats ---/+++ as file headers only as a pair, so removed SQL comments stay removals", () => {
    expect(kinds("--- a/q.sql\n+++ b/q.sql\n--- old comment\n+-- new comment")).toEqual(["header", "header", "del", "add"]);
  });

  it("colors each file by its own extension and leaves unknown extensions plain", () => {
    const text = "diff --git a/a.py b/a.py\n+def f():\ndiff --git a/notes.txt b/notes.txt\n+def f():";
    const model = parseDiff(text);
    const keywordLines = model.spans
      .filter((span) => span.kind === "keyword")
      .map((span) => model.lines.findIndex((line) => span.start >= line.start && span.end <= line.end));
    expect(keywordLines).toEqual([1]);
  });

  it("leaves prose lines uncolored but keeps code and comments colored", () => {
    const text = "-2. Reload - Install it from the folder, then reload as soon as it is done.\n+const step = await next(design);\n+// when the build is done, in this order";
    const model = parseDiff(text);
    const colored = model.spans.filter((span) => span.kind !== "addSign" && span.kind !== "delSign").map((span) => `${span.kind}:${text.slice(span.start, span.end)}`);
    expect(colored).toEqual(["keyword:const", "operator:=", "keyword:await", "function:next", "comment:// when the build is done, in this order"]);
  });
});

describe("word edits", () => {
  const marked = (text: string) =>
    parseDiff(text).edits.map((edit) => `${edit.kind}:${text.slice(edit.start, edit.end)}`);

  it("marks what changed between a paired removal and addition, in whole words", () => {
    expect(marked('- const a = "true" || !isProduction;\n+ const a = "true";')).toEqual(["delEdit:|| !isProduction"]);
    expect(marked("-  return fooBar(x);\n+  return fooBaz(x, y);")).toEqual(["delEdit:fooBar(x", "addEdit:fooBaz(x, y"]);
  });

  it("pairs rows in order within a run and leaves rewrites and re-indents unmarked", () => {
    expect(marked("-a = 1\n-b = 2\n+a = 10\n+b = 2\n+c = 3")).toEqual(["delEdit:1", "addEdit:10"]);
    expect(marked("-    if args.verbose == True:\n+    # verbose flag is a bool")).toEqual([]);
    expect(marked("-  x = 1\n+    x = 1")).toEqual([]);
  });

  it("marks every scattered edit of a long prose line, not one span from first to last change", () => {
    const before = "-Install it from the folder and reload Paseo when the build is done, in this order: plugin, then theme. When colors change, reload.";
    const after = "+Install it from the folder with one command, and reload Paseo once the build is done, in this order: plugin, then theme. Skip what exists. When colors change, reload.";
    expect(marked(`${before}\n${after}`)).toEqual(["addEdit:with one command,", "delEdit:when", "addEdit:once", "addEdit:Skip what exists."]);
  });

  it("pairs a removal with the addition it resembles, not just the one at the same position", () => {
    const text = "-  fontWeight: medium,\n-  flexShrink: 1,\n+  fontWeight: normal,";
    expect(marked(text)).toEqual(["delEdit:medium", "addEdit:normal"]);
    expect(marked("-  searchIcon: {\n-    width: 18,\n+  grid: {")).toEqual([]);
  });

  it("leaves a pair unmarked when the marks would cover nearly all of both lines", () => {
    // Real transcript pair: similar enough to pair, but the word diff marks ~96% of each line.
    const text = "-    // Unowned characters fall back to the master client, so an idle character\n+    // Driven by whoever owns this character; unowned characters fall back to";
    expect(marked(text)).toEqual([]);
  });
});
