// OMP's own rules for `/skill:<name>` in a user message (OMP 18.12.6, packages/coding-agent
// skill-command `_w` and packages/tui prompt/skill-tokens.ts; checked live 2026-10-24):
// - Only the FIRST token counts. A token is `/skill:` at the start or after whitespace, followed
//   by whitespace or the end.
// - If that name is a real skill it loads: the token is cut out and the text before and after it
//   are joined with one space. That cut text is what the agent reads after `User:`.
// - Later tokens stay plain text and never load.
// - A message starting with another `/command`, `!` or a `$ ` shell line is never a skill prompt.
// Whether the name is real is not visible in the text; the server checks OMP's session file.

/** Global regex: reset `lastIndex` before each use (`matchAll` copies it). */
export const SKILL_TOKEN = /(^|\s)\/skill:([^\s/]+(?:\/[^\s/]+)?)(?=\s|$)/g;

export interface SkillInvocation {
  name: string;
  /** The message as the agent reads it after `User:` ("" for a bare `/skill:name`). */
  args: string;
}

function isShellLine(text: string): boolean {
  if (text.startsWith("!")) return true;
  if (text[0] !== "$" || text[1] === "{") return false;
  const next = text[text[1] === "$" ? 2 : 1];
  return next === undefined || next === " " || next === "\t" || next === "\n" || next === "\r";
}

function canInvoke(text: string): boolean {
  const start = text.trimStart();
  if (start.startsWith("/skill:")) return true;
  if (start.startsWith("/")) return false;
  return !isShellLine(start);
}

export function parseSkillInvocation(text: string): SkillInvocation | null {
  const start = text.trimStart();
  if (start.startsWith("/skill:")) {
    const space = start.search(/\s/);
    const name = space === -1 ? start.slice(7) : start.slice(7, space);
    if (!name) return null;
    return { name, args: space === -1 ? "" : start.slice(space + 1).trim() };
  }
  if (!canInvoke(start)) return null;
  SKILL_TOKEN.lastIndex = 0;
  const match = SKILL_TOKEN.exec(text);
  if (!match) return null;
  const from = match.index + match[1]!.length;
  const to = match.index + match[0].length;
  const before = text.slice(0, from).trimEnd();
  const after = text.slice(to).trimStart();
  return { name: match[2]!, args: [before, after].filter((part) => part.length > 0).join(" ").trim() };
}

/** Text comparison that ignores whitespace differences between Paseo's bubble and OMP's record. */
export const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
