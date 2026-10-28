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
