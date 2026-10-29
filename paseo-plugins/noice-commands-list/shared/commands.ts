/** Where a command file lives: the agent's project or the daemon user's home. */
export type CommandScope = "project" | "user";
/** Which folder family it came from: `.agents/commands`, or one of the optional extra folders. */
export type CommandSource = "agents" | "claude" | "cursor" | "omp" | "codex";
/** What clicking it in the list does: fill the message box (default) or send at once. */
export type OnClick = "insert" | "send";

export interface ParsedCommandFile {
  description: string;
  argumentHint: string;
  onClick: OnClick;
  /** The file without its frontmatter, trimmed. */
  body: string;
}

export interface Command extends ParsedCommandFile {
  /** File name without `.md`. */
  name: string;
  scope: CommandScope;
  source: CommandSource;
  path: string;
}

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const DESCRIPTION_MAX = 80;

/** Flat `key: value` frontmatter (the only shape command files use); quotes are stripped. */
function readFrontmatter(block: string): Map<string, string> {
  const keys = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1);
    keys.set(match[1].toLowerCase(), value);
  }
  return keys;
}

/** The first non-empty body line without leading `#`s, cut to 80 characters. */
export function fallbackDescription(body: string): string {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/^#+\s*/, "").trim();
    if (!line) continue;
    return line.length > DESCRIPTION_MAX ? `${line.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : line;
  }
  return "";
}

/** Reads `description`, `argument-hint` (or `argumentHint`) and `on-click`; everything else is ignored. */
export function parseCommandFile(text: string): ParsedCommandFile {
  const match = FRONTMATTER.exec(text);
  const keys = match ? readFrontmatter(match[1]) : new Map<string, string>();
  const body = (match ? text.slice(match[0].length) : text).trim();
  return {
    description: keys.get("description") || fallbackDescription(body),
    argumentHint: keys.get("argument-hint") ?? keys.get("argumenthint") ?? "",
    onClick: keys.get("on-click")?.toLowerCase() === "send" ? "send" : "insert",
    body,
  };
}

/** Shell-style split as OMP does it: spaces and tabs separate, single or double quotes group. */
export function splitArguments(text: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === " " || char === "\t") {
      if (current) args.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

const PLACEHOLDER = /\$@\[(\d+)(?::(\d*))?\]|\$ARGUMENTS|\$@|\$(\d+)/g;

/**
 * OMP's expansion of a command body: `$ARGUMENTS` and `$@` are all arguments, `$1`… one each
 * (1-based), `$@[n:len]` a slice. A body without placeholders gets the arguments appended after
 * a blank line. Placeholders with no argument become empty.
 */
export function expandCommand(body: string, argsText: string): string {
  const raw = argsText.trim();
  const args = splitArguments(raw);
  let placed = false;
  const expanded = body.replace(PLACEHOLDER, (match, start?: string, length?: string, position?: string) => {
    placed = true;
    if (position !== undefined) return args[Number(position) - 1] ?? "";
    if (start !== undefined) {
      const from = Number(start) - 1;
      if (from < 0) return "";
      return (length ? args.slice(from, from + Number(length)) : args.slice(from)).join(" ");
    }
    return args.join(" ");
  });
  if (placed || !raw) return expanded;
  return expanded ? `${expanded}\n\n${raw}` : raw;
}

/** Keeps the first command of each name; the input is already in precedence order. */
export function firstOfEachName(commands: readonly Command[]): Command[] {
  const seen = new Set<string>();
  return commands.filter((command) => !seen.has(command.name) && seen.add(command.name));
}

/** Paseo accepts only these as slash command names. */
export const SLASH_NAME = /^[a-z][a-z0-9-]*$/;
