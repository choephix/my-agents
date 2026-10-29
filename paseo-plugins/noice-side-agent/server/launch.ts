import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import { connectLocalDaemon } from "./daemon";
import { copyCompletedSession, removeSessionCopy } from "./full-memory";

export type ChildMode = "fork" | "full";

/** What a child gets beyond the parent's own settings; chosen once the parent is known. */
export interface ChildPlan {
  mode: ChildMode;
  title: string;
  /** Fork mode: the first prompt, sent with the chat-history attachment. */
  forkPrompt: string;
  /** Full mode: the `side-fork` note appended after the copied completed turn. */
  fullNote: string;
  /** Full mode: sent as the child's first message; empty sends nothing. */
  task: string;
  labels: Record<string, string>;
}

export interface LaunchedChild {
  agentId: string;
  mode: ChildMode;
  title: string;
  parent: PaseoAgent;
}

/** Creates a child with the parent's provider, model, mode, thinking, features and cwd. */
export async function launchChild(paseo: PaseoApi, parentId: string, plan: (parent: PaseoAgent) => ChildPlan): Promise<LaunchedChild> {
  const result = await paseo.agents.ref(parentId).refresh();
  if (!result || result.agent.archivedAt) throw new Error("The parent agent is no longer available.");
  const parent = result.agent;
  const { mode, title, forkPrompt, fullNote, task, labels } = plan(parent);
  const thinkingOptionId = parent.thinkingOptionId ?? parent.effectiveThinkingOptionId;
  const featureValues = Object.fromEntries((parent.features ?? []).map(feature => [feature.id, feature.value]));
  const daemon = await connectLocalDaemon();
  let sessionCopy: string | undefined;
  let importedId: string | undefined;
  try {
    // Refuse mismatched daemon homes before any filesystem or agent mutation.
    if (!(await daemon.fetchAgent(parent.id))) throw new Error("Parent is unavailable on this local daemon.");
    if (mode === "fork") {
      const context = await daemon.buildAgentForkContext(parent.id);
      if (!context.attachment) throw new Error(context.error ?? "Paseo could not build fork context.");
      const attachment = { ...context.attachment };
      const prefix = "<chat-history-summary>\n[Earlier history omitted; newest kept]\n";
      if (attachment.text.length > 100_000) attachment.text = prefix + attachment.text.slice(-(100_000 - prefix.length));
      const child = await paseo.agents.create({
        cwd: parent.cwd, parent: parent.id, title, prompt: forkPrompt, labels,
        config: {
          provider: parent.model ? `${parent.provider}/${parent.model}` : parent.provider,
          ...(parent.currentModeId ? { modeId: parent.currentModeId } : {}),
          ...(thinkingOptionId ? { thinkingOptionId } : {}),
          featureValues,
        },
        attachments: [attachment],
      });
      return { agentId: child.id, mode, title, parent };
    }
    if (parent.provider !== "omp") throw new Error("Full memory is OMP-only; use /side --fork for this provider.");
    if (!parent.persistence?.nativeHandle) throw new Error("Parent OMP session file is unavailable.");
    sessionCopy = await copyCompletedSession(parent.persistence.nativeHandle, fullNote);
    const child = await daemon.importAgent({
      providerId: "omp", providerHandleId: sessionCopy, cwd: parent.cwd,
      ...(parent.workspaceId ? { workspaceId: parent.workspaceId } : {}),
      labels: { "paseo.parent-agent-id": parent.id, ...labels },
    });
    importedId = child.id;
    await daemon.updateAgent(child.id, { name: title });
    await daemon.applyAgentConfig(child.id, {
      modelId: parent.model, thinkingOptionId: thinkingOptionId ?? null,
      ...(parent.currentModeId ? { modeId: parent.currentModeId } : {}), featureValues,
    });
    if (task) await daemon.sendAgentMessage(child.id, task);
    return { agentId: child.id, mode, title, parent };
  } catch (error) {
    // A failed full-mode launch must not leave an active half-configured child.
    if (importedId) await daemon.archiveAgent(importedId);
    if (sessionCopy) await removeSessionCopy(sessionCopy);
    throw error;
  } finally { await daemon.close(); }
}

export function childTitle(prefix: string, text: string): string {
  return `${prefix}: ${text.replace(/\s+/g, " ").slice(0, 64)}`;
}
