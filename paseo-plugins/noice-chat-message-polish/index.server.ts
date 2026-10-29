import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { readSession } from "./server/sessions";
import { preferences } from "./shared/preferences";
import { skillBody, skillMessages, type SkillMessages } from "./shared/skills";

type Paseo = PluginHandlerContext["paseo"];

/** OMP's session file for a chat, from Paseo's persistence handle; null for other providers. */
function sessionFileOf(agent: { provider: string; persistence: { provider: string; nativeHandle?: string | null } | null }): string | null {
  const handle = agent.persistence;
  if (!handle?.nativeHandle || (handle.provider !== "omp" && agent.provider !== "omp")) return null;
  return handle.nativeHandle;
}

/** The chat in view, or every live chat of the workspace in view (the page can't tell which pane a bubble is in). */
async function sessionsInView(paseo: Paseo, input: { agentId?: string; workspaceId?: string }): Promise<{ agentId: string; path: string }[]> {
  if (input.agentId) {
    const found = await paseo.agents.ref(input.agentId).refresh();
    const path = found ? sessionFileOf(found.agent) : null;
    return path ? [{ agentId: input.agentId, path }] : [];
  }
  if (!input.workspaceId) return [];
  const sessions: { agentId: string; path: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    for (const { agent } of page.entries) {
      const path = agent.workspaceId === input.workspaceId ? sessionFileOf(agent) : null;
      if (path) sessions.push({ agentId: agent.id, path });
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return sessions;
}

export default function contribute(server: PluginServerContext) {
  server.registerSettings(preferences);
  const sessionPaths = new Map<string, string>();

  server.handle(skillMessages, async (input, { paseo }) => {
    const sessions = await sessionsInView(paseo, input);
    const result: SkillMessages = { searched: 0, skills: [], files: [] };
    for (const { agentId, path } of sessions) {
      sessionPaths.set(agentId, path);
      // A session file that's gone (deleted chat) just has nothing to show.
      const parsed = await readSession(path).catch(() => null);
      if (!parsed) continue;
      result.searched += 1;
      for (const skill of parsed.skills) result.skills.push({ agentId, ...skill });
      for (const mention of parsed.mentions) result.files.push({ agentId, ...mention });
    }
    return result;
  });

  server.handle(skillBody, async ({ agentId, id, file }, { paseo }) => {
    const path = sessionPaths.get(agentId) ?? (await sessionsInView(paseo, { agentId }))[0]?.path;
    if (!path) return { text: null };
    const parsed = await readSession(path).catch(() => null);
    if (!parsed) return { text: null };
    return { text: file === undefined ? parsed.bodies.get(id) ?? null : parsed.fileBodies.get(id)?.[file] ?? null };
  });

  return () => {};
}
