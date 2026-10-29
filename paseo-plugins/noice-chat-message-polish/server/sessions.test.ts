import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSession } from "./sessions";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function sessionFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "ump-session-"));
  dirs.push(dir);
  return join(dir, "session.jsonl");
}

const line = (entry: unknown) => `${JSON.stringify(entry)}\n`;
// OMP's template writes the `User:` text with each line's trailing spaces dropped; details.args keeps them.
const skillPrompt = (id: string, name: string, args: string, prompt: string) => line({
  type: "custom_message", customType: "skill-prompt", display: true, attribution: "user", id,
  details: { name, path: `/skills/${name}/SKILL.md`, args, prompt },
  content: `[IMPORTANT: User invoked the "${name}" skill; follow its instructions. Full skill below.]\n\nBody of ${name}.\n\n[Skill directory: /skills/${name}]\nResolve relative paths…${args ? `\nUser: ${args.replace(/ +\n/g, "\n")}` : ""}`,
});

describe("readSession", () => {
  it("returns the skill wrapper without OMP's trailing User: line, even when the typed text had trailing spaces", async () => {
    const path = sessionFile();
    writeFileSync(path, skillPrompt("a1", "pith", "say OK. \n\nThanks", "say OK. \n\nThanks /skill:pith"));
    const parsed = await readSession(path);
    expect(parsed.skills).toEqual([{ id: "a1", name: "pith", args: "say OK. \n\nThanks", prompt: "say OK. \n\nThanks /skill:pith" }]);
    expect(parsed.bodies.get("a1")).toMatch(/Resolve relative paths…$/);
  });

  it("keeps a bare skill's wrapper whole", async () => {
    const path = sessionFile();
    writeFileSync(path, skillPrompt("b1", "pith", "", "/skill:pith"));
    expect((await readSession(path)).bodies.get("b1")).toMatch(/Resolve relative paths…$/);
  });

  it("picks up entries appended after the first read, including a line split across reads", async () => {
    const path = sessionFile();
    const second = skillPrompt("c2", "grilling", "go", "/skill:grilling go");
    writeFileSync(path, skillPrompt("c1", "pith", "x", "/skill:pith x") + second.slice(0, 40));
    expect((await readSession(path)).skills.map((skill) => skill.id)).toEqual(["c1"]);
    appendFileSync(path, second.slice(40));
    expect((await readSession(path)).skills.map((skill) => skill.id)).toEqual(["c1", "c2"]);
  });

  it("ties an attached file to the user message right before it", async () => {
    const path = sessionFile();
    writeFileSync(path,
      line({ type: "message", id: "u1", message: { role: "user", content: [{ type: "text", text: "Is @notes.md current?" }] } })
      + line({ type: "message", id: "f1", message: { role: "fileMention", files: [{ path: "/w/notes.md", content: "1:a\n2:b\n3:c" }] } }));
    const parsed = await readSession(path);
    expect(parsed.mentions).toEqual([{ id: "f1", after: "Is @notes.md current?", files: [{ path: "/w/notes.md", lines: 3 }] }]);
    expect(parsed.fileBodies.get("f1")).toEqual(["1:a\n2:b\n3:c"]);
  });
});
