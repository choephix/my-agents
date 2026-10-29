/*
 * The text a finished tangent sends into its parent, and its reading back for display.
 * The parent model gets this text as it is; only the app draws it as a row.
 */

/** Every tangent report starts with this; OMP parents receive it as `/follow-up <report>`. */
export const TANGENT_REPORT_START = 'Tangent "';
/** Joins the reports held for a busy non-OMP parent into one message. */
export const REPORT_SEPARATOR = "\n\n---\n\n";

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

/** A type alias, not an interface: timeline item data must be assignable to JSON. */
export type ParsedReport = {
  title: string;
  status: "done" | "failed" | "stopped" | "archived";
  /** `formatDuration` text. */
  took: string;
  /** done: the reply; failed: the error; otherwise empty. */
  body: string;
  link: string;
  agentId: string;
  serverId: string;
};

/** One `formatTangentReport` text, whole. The title is one line (`childTitle` collapses whitespace). */
const REPORT =
  /^Tangent "([^\n]*)" (?:finished \(([^()\n]+)\):\n\n([\s\S]*)|failed after ([^:\n]+): ([\s\S]*)|was stopped after ([^,\n]+), before it finished\.|was archived after ([^,\n]+), before it finished\.)\n\nOpen the tangent: (\S+)$/;
/** The link's route, the same in `https://…/h/…` and `paseo://h/…` links. */
const ROUTE = /\/h\/([^/\s]+)\/agent\/([^/?#\s]+)$/;
/** Where one report ends: its link line, then the next report or the end of the message. */
const REPORT_END = /\n\nOpen the tangent: \S+(?=\n\n---\n\nTangent "|$)/g;

function parseReport(text: string): ParsedReport | undefined {
  const match = REPORT.exec(text);
  const route = match && ROUTE.exec(match[8]);
  if (!match || !route) return undefined;
  const [, title, doneTook, reply, failTook, error, stopTook, archiveTook, link] = match;
  const ids = { link, serverId: decodeURIComponent(route[1]), agentId: decodeURIComponent(route[2]) };
  if (doneTook !== undefined) return { title, status: "done", took: doneTook, body: reply, ...ids };
  if (failTook !== undefined) return { title, status: "failed", took: failTook, body: error, ...ids };
  if (stopTook !== undefined) return { title, status: "stopped", took: stopTook, body: "", ...ids };
  return { title, status: "archived", took: archiveTook, body: "", ...ids };
}

/**
 * The reports in a parent's message: one, or several joined with `REPORT_SEPARATOR`.
 * Undefined unless the whole message is reports, so any other message keeps its bubble.
 */
export function parseTangentReports(message: string): ParsedReport[] | undefined {
  const text = message.trimEnd();
  if (!text.startsWith(TANGENT_REPORT_START)) return undefined;
  const reports: ParsedReport[] = [];
  let start = 0;
  for (const match of text.matchAll(REPORT_END)) {
    const end = match.index + match[0].length;
    const report = parseReport(text.slice(start, end));
    if (!report) return undefined;
    reports.push(report);
    start = end + REPORT_SEPARATOR.length;
  }
  return reports.length && start === text.length + REPORT_SEPARATOR.length ? reports : undefined;
}
