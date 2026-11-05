import type { PaseoApi } from "@getpaseo/client";

/** Enough for two lines in the list. */
const PREVIEW_CHARS = 400;

export function clip(text: string): string {
  // Markdown syntax reads as noise in a two-line preview: fences, links (kept as their text), `code` and **bold** marks.
  const flat = text
    .replace(/```[\w-]*/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
}

/** The text of the agent's final reply: the last run of assistant messages in its timeline. */
export async function finalReply(paseo: PaseoApi, agentId: string): Promise<string> {
  const page = await paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: 30 });
  const items = page.entries.map((entry) => entry.item);
  const end = items.findLastIndex((item) => item.type === "assistant_message");
  if (end < 0) return "";
  let start = end;
  while (start > 0 && items[start - 1]?.type === "assistant_message") start -= 1;
  return items
    .slice(start, end + 1)
    .map((item) => (item.type === "assistant_message" ? item.text : ""))
    .join("");
}
