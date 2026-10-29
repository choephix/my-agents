/** A Paseo chat tab named by its web link. */
export interface AgentLink {
  serverId: string;
  agentId: string;
}

// https://app.paseo.sh/h/<serverId>/agent/<agentId>: the form agent cards embed and link clicks open in place.
const LINK = /^https:\/\/app\.paseo\.sh\/h\/([^/?#]+)\/agent\/([^/?#]+)\/?$/i;

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

export function parseAgentLink(href: string): AgentLink | null {
  const match = LINK.exec(href.trim());
  if (!match) return null;
  const serverId = decode(match[1]);
  const agentId = decode(match[2]);
  return serverId && agentId ? { serverId, agentId } : null;
}
