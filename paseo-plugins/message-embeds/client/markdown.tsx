import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Markdown, StreamedText } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { readChatRepo } from "../shared/preferences";
import { linkIssueRefs } from "./parse";

export const markdownSchema = z.object({
  text: z.string(),
  phase: z.enum(["streaming", "complete"]),
});

type MarkdownData = z.output<typeof markdownSchema>;

/** One lookup per chat for the whole session: a chat's folder keeps its repository. */
const repos = new Map<string, Promise<string | null>>();

export function MarkdownChunk({ item, agentId }: PluginTimelineItemProps<MarkdownData>) {
  const { text, phase } = item.data;
  const readRepo = useRpc(readChatRepo);
  const [repo, setRepo] = useState<string | null>(null);
  const wantsRepo = phase === "complete" && linkIssueRefs(text, () => "") !== text;
  useEffect(() => {
    if (!wantsRepo) return;
    let live = true;
    let lookup = repos.get(agentId);
    if (!lookup) {
      lookup = readRepo({ agentId }).then((result) => result.url, () => null);
      repos.set(agentId, lookup);
    }
    void lookup.then((url) => {
      if (live) setRepo(url);
    });
    return () => { live = false; };
  }, [agentId, wantsRepo, readRepo]);
  // GitHub's /issues/N redirects to /pull/N when N is a pull request.
  const linked = useMemo(() => (repo && wantsRepo ? linkIssueRefs(text, (n) => `[#${n}](${repo}/issues/${n})`) : text), [repo, text, wantsRepo]);
  return phase === "streaming" ? <StreamedText text={text} phase="streaming" /> : <Markdown>{linked}</Markdown>;
}
