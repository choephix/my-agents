import type { PaseoAgentHandle } from "@getpaseo/client";
import { defaultTitle } from "../shared/agent-titles.mjs";

// Enough recent history to see the latest subjects: pages back until six user
// turns are in view, at most 500 items.
export async function recentTimeline(handle: PaseoAgentHandle) {
  const items = [];
  let page = await handle.timeline.refetch({ direction: "tail", limit: 100, projection: "canonical" });
  for (let pages = 1; ; pages++) {
    if (page.error) throw new Error(page.error);
    items.unshift(...page.entries.map(entry => entry.item));
    if (pages >= 5 || !page.hasOlder || !page.startCursor || items.filter(item => item.type === "user_message").length >= 6) return items;
    page = await handle.timeline.refetch({ direction: "before", cursor: page.startCursor, limit: 100, projection: "canonical" });
  }
}

// The first 20 timeline items: how the conversation began.
export async function openingTimeline(handle: PaseoAgentHandle) {
  const page = await handle.timeline.refetch({ direction: "after", limit: 20, projection: "canonical" });
  if (page.error) throw new Error(page.error);
  return page.entries.map(entry => entry.item);
}

// Paseo's placeholder is the first line of the first prompt. Like the tab's own
// check, accept any user message near the start: other user items can precede it.
export async function openingPromptLines(handle: PaseoAgentHandle) {
  return (await openingTimeline(handle)).flatMap(item => item.type === "user_message" && item.text ? [defaultTitle(item.text)] : []).filter((line): line is string => !!line);
}
