import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Markdown, StreamedText } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { readChatRepo, resolveVaultNames } from "../shared/preferences";
import { addColorSwatches, linkIssueRefs, linkWikiLinks, vaultWikiNames } from "./parse";
import { swatch, SWATCHES } from "./web";

export const markdownSchema = z.object({
  text: z.string(),
  phase: z.enum(["streaming", "complete"]),
});

type MarkdownData = z.output<typeof markdownSchema>;

/** One lookup per chat for the whole session: a chat's folder keeps its repository. */
const repos = new Map<string, Promise<string | null>>();

/** The last vault answer per set of names, so a remounted chunk starts linked; asked again on every mount. */
const vaultAnswers = new Map<string, ReadonlyMap<string, string>>();

/**
 * `text` with its wiki links as Markdown links. While `active`, vault names (`[[note]]`, `[[a/map]]`) are looked
 * up in the vault folder; until the answer comes, and for names it lacks, they link as before.
 */
export function useWikiLinks(text: string, active: boolean): string {
  const resolve = useRpc(resolveVaultNames);
  const key = useMemo(() => (active ? vaultWikiNames(text).join("\n") : ""), [text, active]);
  const [paths, setPaths] = useState(() => vaultAnswers.get(key));
  useEffect(() => {
    if (!key) return;
    let live = true;
    setPaths(vaultAnswers.get(key));
    resolve({ names: key.split("\n") }).then((result) => {
      const next = new Map(Object.entries(result.paths));
      vaultAnswers.delete(key);
      vaultAnswers.set(key, next);
      if (vaultAnswers.size > 40) vaultAnswers.delete(vaultAnswers.keys().next().value as string);
      if (live) setPaths(next);
    }, () => {});
    return () => { live = false; };
  }, [key, resolve]);
  return useMemo(() => linkWikiLinks(text, { vaultPaths: paths }), [text, paths]);
}

export function MarkdownChunk({ item, agentId }: PluginTimelineItemProps<MarkdownData>) {
  const { phase } = item.data;
  // The transformer leaves wiki links to vault names to this pass while a vault folder is set.
  const text = useWikiLinks(item.data.text, phase === "complete");
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
  const linked = useMemo(() => {
    const issues = repo && wantsRepo ? linkIssueRefs(text, (n) => `[#${n}](${repo}/issues/${n})`) : text;
    return SWATCHES ? addColorSwatches(issues, swatch) : issues;
  }, [repo, text, wantsRepo]);
  return phase === "streaming" ? <StreamedText text={item.data.text} phase="streaming" /> : <Markdown>{linked}</Markdown>;
}
