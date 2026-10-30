import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { REPORT_SEPARATOR } from "../shared/report";

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

/** A `report_to_parent` call. */
export interface ExplicitReport { summary: string; result: string; files: string[] }

/** A `report_to_parent` call as one summary line and the rest (result, file list); the report's reply is both, summary first. */
export function explicitReply({ summary, result, files }: ExplicitReport): { summary: string; body: string } {
  const list = files.length ? `\n\nFiles:\n${files.map(file => `- \`${file}\``).join("\n")}` : "";
  return { summary: summary.replace(/\s+/g, " ").trim(), body: `${result.trim()}${list}` };
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
  const text = reports.join(REPORT_SEPARATOR);
  return delivery === "follow-up" ? `/follow-up ${text}` : text;
}
