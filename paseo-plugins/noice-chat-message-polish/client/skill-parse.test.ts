import { describe, expect, it } from "vitest";
import { parseSkillInvocation } from "./skill-parse";

// Expected values are what OMP 18.12.6 recorded as the skill and the `User:` text for the
// same messages in a live session (2026-10-24).
describe("parseSkillInvocation", () => {
  it("cuts a token on its own last line and drops the blank lines around it", () => {
    expect(parseSkillInvocation("Say OK.\n\nHere is a skill.\n\n/skill:writing-for-agents"))
      .toEqual({ name: "writing-for-agents", args: "Say OK.\n\nHere is a skill." });
  });

  it("joins the text around a mid-sentence token with one space", () => {
    expect(parseSkillInvocation("Please use /skill:pith to\nreply with OK."))
      .toEqual({ name: "pith", args: "Please use to\nreply with OK." });
  });

  it("loads only the first of two tokens and keeps the second as text", () => {
    expect(parseSkillInvocation("Say OK.\n\n/skill:pith\n/skill:grilling"))
      .toEqual({ name: "pith", args: "Say OK. /skill:grilling" });
    expect(parseSkillInvocation("/skill:pith say OK.\n\n/skill:grilling"))
      .toEqual({ name: "pith", args: "say OK.\n\n/skill:grilling" });
  });

  it("gives an empty text for a bare token", () => {
    expect(parseSkillInvocation("  /skill:pith  ")).toEqual({ name: "pith", args: "" });
  });

  it("parses Paseo's rebuilt bubble (`/skill:name text`) to the same result as the typed one", () => {
    const typed = parseSkillInvocation("Rewrite it using /skill:writing-for-agents as the guide.");
    expect(parseSkillInvocation(`/skill:${typed!.name} ${typed!.args}`)).toEqual(typed);
  });

  it("ignores tokens glued to other text and messages that are another command or a shell line", () => {
    expect(parseSkillInvocation("see foo/skill:pith here")).toBeNull();
    expect(parseSkillInvocation("/compact then /skill:pith")).toBeNull();
    expect(parseSkillInvocation("! ls /skill:pith")).toBeNull();
    expect(parseSkillInvocation("$ echo /skill:pith")).toBeNull();
    expect(parseSkillInvocation("${HOME} uses /skill:pith")).toEqual({ name: "pith", args: "${HOME} uses" });
  });
});
