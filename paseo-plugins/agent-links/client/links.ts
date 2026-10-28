/** The chat tab a link points at. */
export interface AgentLink {
  serverId: string;
  agentId: string;
}

// https://app.paseo.sh/h/<serverId>/agent/<agentId>, nothing else.
const LINK = /^https:\/\/app\.paseo\.sh\/h\/([^/?#]+)\/agent\/([^/?#]+)\/?$/i;

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/** The chat tab an `app.paseo.sh` agent link opens, or null for every other link. */
export function parseAgentLink(href: string): AgentLink | null {
  const match = LINK.exec(href.trim());
  if (!match) return null;
  const serverId = decode(match[1]);
  const agentId = decode(match[2]);
  return serverId && agentId ? { serverId, agentId } : null;
}

/** Assistant text cut around links that get a preview. */
export type Segment =
  | { kind: "markdown"; text: string }
  | { kind: "preview"; link: AgentLink; line: string };

// A whole line that is only an agent link: bare, <autolinked> or [label](url). List items,
// emphasis and links inside sentences don't match, so lists of tab links stay plain links.
const ALONE = /^ {0,3}(?:\[[^\]\n]*\]\((\S+)\)|<(\S+)>|(\S+))\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Splits text at lines that hold nothing but an `app.paseo.sh` agent link, outside code fences.
 * Returns null when no line qualifies.
 */
export function splitPreviewLines(text: string): Segment[] | null {
  const out: Segment[] = [];
  let markdown = "";
  let fence: string | null = null;
  let found = false;
  for (const line of text.split("\n")) {
    const opener = FENCE.exec(line)?.[1];
    if (fence) {
      if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = null;
    } else if (opener) {
      fence = opener;
    } else {
      const match = ALONE.exec(line);
      const link = match ? parseAgentLink(match[1] ?? match[2] ?? match[3]) : null;
      if (link) {
        if (markdown.trim()) out.push({ kind: "markdown", text: markdown });
        markdown = "";
        out.push({ kind: "preview", link, line: line.trim() });
        found = true;
        continue;
      }
    }
    markdown += `${line}\n`;
  }
  if (markdown.trim()) out.push({ kind: "markdown", text: markdown.replace(/\n$/, "") });
  return found ? out : null;
}
