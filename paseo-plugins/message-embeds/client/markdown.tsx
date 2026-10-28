import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Markdown, StreamedText } from "@getpaseo/plugin/client/ui";
import { z } from "zod";

export const markdownSchema = z.object({
  text: z.string(),
  phase: z.enum(["streaming", "complete"]),
});

type MarkdownData = z.output<typeof markdownSchema>;

export function MarkdownChunk({ item }: PluginTimelineItemProps<MarkdownData>) {
  return item.data.phase === "streaming" ? <StreamedText text={item.data.text} phase="streaming" /> : <Markdown>{item.data.text}</Markdown>;
}
