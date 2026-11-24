export interface ParsedSlipMarkdown {
  frontMatter: Record<string, string>;
  title: string;
  summary: string;
  body: string;
}

const FRONT_MATTER_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const FIELD_RE = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;
const HEADING_RE = /^\s*#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\r?\n|$)/;

function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1).trim();
  }
  // Drop trailing YAML comments separated by whitespace (`value # comment`), while keeping `#` inside URLs/colors.
  const commentIndex = trimmed.search(/[ \t]+#/);
  return (commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed).trim();
}

export function parseFrontMatter(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = FIELD_RE.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = unquoteYamlScalar(match[2]);
    if (value) fields[key] = value;
  }
  return fields;
}

function stripInlineMarkdown(line: string): string {
  return line
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => (alias ?? target).trim())
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => (alias ?? target).trim())
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSummary(body: string): string {
  let inFence = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^(?:`{3,}|~{3,})/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^(?:#{1,6}\s|---+|\*\*\*+|___+|!\[\[)/.test(trimmed)) continue;
    const cleaned = stripInlineMarkdown(trimmed.replace(/^>\s?/, "").replace(/^[-*+]\s+/, ""));
    if (cleaned) return cleaned;
  }
  return "";
}

/** Parse a slip's YAML front matter, H1 title (falling back to front matter `title` or `fallbackTitle`), and lead summary. */
export function parseSlipMarkdown(content: string, fallbackTitle: string): ParsedSlipMarkdown {
  const fmMatch = FRONT_MATTER_RE.exec(content);
  const frontMatter = fmMatch?.[1] ? parseFrontMatter(fmMatch[1]) : {};
  let body = fmMatch ? content.slice(fmMatch[0].length) : content;

  let title = frontMatter.title || fallbackTitle;
  const headingMatch = HEADING_RE.exec(body);
  if (headingMatch) {
    const heading = stripInlineMarkdown(headingMatch[1]);
    if (heading) title = heading;
    body = body.slice(headingMatch[0].length);
  }

  return {
    frontMatter,
    title,
    summary: extractSummary(body),
    body: body.trim(),
  };
}
