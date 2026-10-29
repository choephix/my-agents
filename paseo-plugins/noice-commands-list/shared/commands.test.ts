import { describe, expect, it } from "vitest";
import { expandCommand, parseCommandFile } from "./commands";

describe("parseCommandFile", () => {
  it("reads description, argument-hint and on-click, and strips the frontmatter", () => {
    const file = '---\ndescription: "Review the diff"\nargument-hint: <scope>\non-click: send\nmodel: x\n---\n\nReview $ARGUMENTS.\n';
    expect(parseCommandFile(file)).toEqual({ description: "Review the diff", argumentHint: "<scope>", onClick: "send", body: "Review $ARGUMENTS." });
  });

  it("defaults to insert and falls back to the first body line without its heading marks", () => {
    expect(parseCommandFile("# Remove AI code slop\n\nCheck the diff.")).toEqual({
      description: "Remove AI code slop",
      argumentHint: "",
      onClick: "insert",
      body: "# Remove AI code slop\n\nCheck the diff.",
    });
  });

  it("treats unknown on-click values as insert", () => {
    expect(parseCommandFile("---\non-click: maybe\n---\nx").onClick).toBe("insert");
  });
});

describe("expandCommand", () => {
  it("fills OMP placeholders: $ARGUMENTS, $@, 1-based $N, slices", () => {
    expect(expandCommand("a=[$1] b=[$2] all=[$ARGUMENTS] at=[$@] tail=[$@[2]]", 'one "two three" four')).toBe(
      "a=[one] b=[two three] all=[one two three four] at=[one two three four] tail=[two three four]",
    );
  });

  it("appends the arguments after a blank line when the body has no placeholder", () => {
    expect(expandCommand("Commit it.", "  scope: ui ")).toBe("Commit it.\n\nscope: ui");
  });

  it("empties placeholders without arguments and leaves a plain body alone", () => {
    expect(expandCommand("Fix #$1 now.", "")).toBe("Fix # now.");
    expect(expandCommand("Commit it.", "")).toBe("Commit it.");
  });
});
