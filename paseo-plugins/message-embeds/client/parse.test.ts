import { describe, expect, it } from "vitest";
import { linkIssueRefs, parseMessage } from "./parse";

describe("message embed parser", () => {
  it("extracts a complete embed and preserves surrounding markdown", () => {
    expect(parseMessage("Before ![[src/tree.ts#L40-80]] after")).toEqual([
      { kind: "markdown", id: "markdown-0", text: "Before " },
      {
        kind: "embed",
        embed: { id: "embed-0", original: "![[src/tree.ts#L40-80]]", path: "src/tree.ts", lineStart: 40, lineEnd: 80 },
      },
      { kind: "markdown", id: "markdown-2", text: " after" },
    ]);
  });

  it("does not convert embeds in fenced or inline code", () => {
    const text = "```diff\n![[ignored.ts]]\n```\nUse `![[also-ignored.ts]]` but ![[real.ts]].";
    const segments = parseMessage(text);
    expect(segments.filter((segment) => segment.kind === "embed")).toHaveLength(1);
    expect(segments.find((segment) => segment.kind === "embed")).toMatchObject({ embed: { path: "real.ts" } });
    expect(segments.filter((segment) => segment.kind === "markdown").map((segment) => segment.text).join("")).toContain("ignored.ts");
  });

  it("supports a single-line range and leaves half-typed embeds as text", () => {
    expect(parseMessage("![[src/file.ts#L7]]")).toMatchObject([
      { kind: "embed", embed: { path: "src/file.ts", lineStart: 7, lineEnd: 7 } },
    ]);
    expect(parseMessage("Typing ![[foo")).toMatchObject([{ kind: "markdown", text: "Typing ![[foo" }]);
  });

  it("does not convert embeds in a fence nested inside a list item", () => {
    const text = "1. Step\n\n    ```ts\n    ![[ignored.ts]]\n    ```\n";
    expect(parseMessage(text).some((segment) => segment.kind === "embed")).toBe(false);
  });

  it("accepts the GitHub-style #L40-L80 range", () => {
    expect(parseMessage("![[src/file.ts#L40-L80]]")).toMatchObject([
      { kind: "embed", embed: { path: "src/file.ts", lineStart: 40, lineEnd: 80 } },
    ]);
  });

  it("links #123 only outside code, existing links and words", () => {
    const link = (n: string) => `<${n}>`;
    const text = [
      "Fixed in #123 and (#45); option #2 stays.",
      "See `#99` and [#77](https://x) and abc#88 and #12-b.",
      "```",
      "#555",
      "```",
    ].join("\n");
    expect(linkIssueRefs(text, link)).toBe([
      "Fixed in <123> and (<45>); option #2 stays.",
      "See `#99` and [#77](https://x) and abc#88 and #12-b.",
      "```",
      "#555",
      "```",
    ].join("\n"));
  });
});
