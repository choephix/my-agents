import { describe, expect, it } from "vitest";
import { appendQuote } from "./quote";

describe("appendQuote", () => {
  it("starts an empty message box with the quote and one blank line", () => {
    expect(appendQuote("", "Use the cache.")).toEqual({ text: "> Use the cache.\n\n", caret: 18 });
  });

  it("treats a whitespace-only draft as empty, with no leading blank lines", () => {
    expect(appendQuote("  \n\t\n", "Use the cache.")).toEqual({ text: "> Use the cache.\n\n", caret: 18 });
  });

  it("puts the quote one blank line after a draft that already has text", () => {
    expect(appendQuote("Two things:", "Use the cache.")).toEqual({
      text: "Two things:\n\n> Use the cache.\n\n",
      caret: 31,
    });
  });

  it("collapses a draft's trailing newlines to one blank line and keeps the rest of the draft", () => {
    expect(appendQuote("First line\n\n  indented\n\n\n", "x")?.text).toBe("First line\n\n  indented\n\n> x\n\n");
  });

  it("marks blank lines inside a multi-line selection with a bare >", () => {
    expect(appendQuote("", "First paragraph.\n\nSecond paragraph,\nline two.")?.text).toBe(
      "> First paragraph.\n>\n> Second paragraph,\n> line two.\n\n",
    );
  });

  it("drops a selection's trailing newline instead of quoting an empty line", () => {
    expect(appendQuote("", "Whole line\n")?.text).toBe("> Whole line\n\n");
    expect(appendQuote("ok", "\n\nWhole line\n\n")?.text).toBe("ok\n\n> Whole line\n\n");
  });

  it("keeps indentation, drops trailing spaces, and accepts Windows line ends", () => {
    expect(appendQuote("", "if (x) {\r\n    run();   \r\n \r\n}")?.text).toBe("> if (x) {\n>     run();\n>\n> }\n\n");
  });

  it("leaves the draft alone when only whitespace was selected", () => {
    expect(appendQuote("draft", " \n\n ")).toBeNull();
  });
});
