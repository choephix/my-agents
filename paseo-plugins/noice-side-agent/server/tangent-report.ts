import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { TANGENT_REPORT_START } from "../shared/preferences";

/** How a tangent's watched turn ended. `archived`: archived before its turn ended. */
export type TangentOutcome =
  | { kind: "completed" }
  | { kind: "failed"; message: string }
  | { kind: "canceled" }
  | { kind: "archived" };

export interface TangentReport {
  title: string;
  durationMs: number;
  outcome: TangentOutcome;
  /** The child's final reply; used only when the turn completed. */
  reply: string;
  link: string;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatTangentReport({ title, durationMs, outcome, reply, link }: TangentReport): string {
  const name = `${TANGENT_REPORT_START}${title}"`;
  const took = formatDuration(durationMs);
  const open = `Open the tangent: ${link}`;
  switch (outcome.kind) {
    case "completed":
      return `${name} finished (${took}):\n\n${reply.trim() || "(It ended without a text reply.)"}\n\n${open}`;
    case "failed":
      return `${name} failed after ${took}: ${outcome.message}\n\n${open}`;
    case "canceled":
      return `${name} was stopped after ${took}, before it finished.\n\n${open}`;
    case "archived":
      return `${name} was archived after ${took}, before it finished.\n\n${open}`;
  }
}

/**
 * The text of the turn's last assistant message: the final run of assistant
 * text after the latest user message. Text before a later tool call is
 * narration, not the reply.
 */
export function finalReply(items: readonly AgentTimelineItem[]): string {
  let reply = "";
  let inRun = false;
  for (const item of items) {
    if (item.type === "assistant_message") {
      reply = inRun ? reply + item.text : item.text;
      inRun = true;
    } else if (item.type === "user_message") {
      reply = "";
      inRun = false;
    } else if (item.type !== "reasoning") {
      inRun = false;
    }
  }
  return reply;
}

export type Delivery = "follow-up" | "send-now" | "wait-for-idle";

/**
 * OMP queues a `/follow-up` behind its running reply on its own. Other providers
 * would have their running turn interrupted by a send, so the report waits.
 */
export function chooseDelivery(provider: string, status: string): Delivery {
  if (provider === "omp") return "follow-up";
  return status === "running" || status === "initializing" ? "wait-for-idle" : "send-now";
}

export function deliveryText(delivery: Delivery, reports: readonly string[]): string {
  const text = reports.join("\n\n---\n\n");
  return delivery === "follow-up" ? `/follow-up ${text}` : text;
}
