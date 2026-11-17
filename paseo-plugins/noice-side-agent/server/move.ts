import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { connectLocalDaemon } from "./daemon";
import { launchChild } from "./launch";

export interface MoveResult {
  agentId: string;
  workspaceId: string;
  how: "moved" | "fork" | "full";
}

async function existingFolder(input: string): Promise<string> {
  const path = resolve(input.replace(/^~(?=\/|$)/, homedir()));
  if (!(await stat(path).catch(() => null))?.isDirectory()) throw new Error(`No such folder: ${input}`);
  return path;
}

/**
 * Same folder: archive the agent and re-import its session into a new workspace, which Paseo
 * does by unarchiving the same agent there. Another folder: Paseo refuses that import, so a new
 * agent continues the chat there (full OMP memory, else Paseo's fork context) and the old one is archived.
 */
export async function moveTab(paseo: PaseoApi, { agentId, folder, title }: { agentId: string; folder: string; title: string }): Promise<MoveResult> {
  const agent = (await paseo.agents.ref(agentId).refresh())?.agent;
  if (!agent || agent.archivedAt) throw new Error("This tab's agent is no longer available.");
  // Archiving stops a running turn.
  if (agent.status === "running") throw new Error("This tab is still working. Move it when its turn ends.");
  const cwd = folder ? await existingFolder(folder) : agent.cwd;
  const real = (path: string) => realpath(path).catch(() => path);
  const same = !folder || (await real(cwd)) === (await real(agent.cwd));
  const workspace = await paseo.workspaces.create({ source: { kind: "directory", path: cwd }, title: title || agent.title || undefined });
  const daemon = await connectLocalDaemon();
  try {
    if (same) {
      const session = agent.persistence;
      if (!session) throw new Error("Paseo has no saved session for this tab, so it can't move it.");
      await daemon.archiveAgent(agent.id);
      try {
        await daemon.importAgent({ providerId: session.provider, providerHandleId: session.sessionId, cwd: agent.cwd, workspaceId: workspace.id });
      } catch (error) {
        // Reopens the archived agent where it was.
        await daemon.refreshAgent(agent.id).catch(restore => console.error(`noice-side-agent: could not reopen ${agent.id} after a failed move.`, restore));
        throw error;
      }
      return { agentId: agent.id, workspaceId: workspace.id, how: "moved" };
    }
    const child = await launchChild(paseo, agent.id, parent => {
      const moved = `This chat continues Paseo chat ${parent.id}, which worked in ${parent.cwd}. You now work in ${cwd}; file paths in the earlier conversation refer to the old folder.`;
      return {
        mode: parent.provider === "omp" ? "full" : "fork",
        title: parent.title?.trim() || "Untitled chat",
        forkPrompt: `${moved} The attached chat history is that conversation. Wait for the user's instructions; reply only: Ready.`,
        fullNote: moved,
        task: "",
        labels: {},
        cwd,
        workspaceId: workspace.id,
        linkParent: false,
      };
    });
    await daemon.archiveAgent(agent.id);
    return { agentId: child.agentId, workspaceId: workspace.id, how: child.mode };
  } catch (error) {
    await workspace.archive().catch(cleanup => console.error(`noice-side-agent: could not archive workspace ${workspace.id} after a failed move.`, cleanup));
    throw error;
  } finally { await daemon.close(); }
}
