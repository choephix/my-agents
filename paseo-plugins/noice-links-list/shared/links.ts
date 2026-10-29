import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * What a click does: `web` and `image` open `url` in the browser, `file` copies `copy`.
 * Configured webshare paths are `web`/`image` with their public URL.
 */
export const LinkKindSchema = z.enum(["web", "image", "file"]);
export type LinkKind = z.infer<typeof LinkKindSchema>;

/** One full URL of a link that was mentioned with several (other query strings, fragments). */
export const LinkVariantSchema = z.object({
  /** The full URL as last written. */
  url: z.string(),
  /** What sets it apart, shown muted: the query string plus any fragment (`?v=tree&title=1`, `#notes`); empty for the bare URL. */
  query: z.string(),
  /** The newest Markdown link text or image alt this URL had. */
  title: z.string().optional(),
  /** Mentions of this exact URL. */
  count: z.number(),
  /** Epoch ms of its newest mention. */
  lastAt: z.number(),
});
export type LinkVariant = z.infer<typeof LinkVariantSchema>;

export const LinkSchema = z.object({
  /** Dedupe key: a normalized URL without query or fragment, or `file:` + absolute path. */
  key: z.string(),
  kind: LinkKindSchema,
  /** One consistent Markdown link text or image alt; else the page or file name (the URL's last path segment). */
  title: z.string(),
  /** Muted: the host, or the folder shortened to `~/…/a/b`. */
  where: z.string(),
  /**
   * What the row shows: the URL without scheme, query and fragment (`example.com/pages/x/`, a webshare
   * `index.html` dropped), or the file path with `~` and its newest `:line`; folders end in `/`.
   */
  path: z.string(),
  /** Lucide icon name for the row. */
  glyph: z.string(),
  /** web/image: what opens, the newest variant's full URL. */
  url: z.string().optional(),
  /** file: the absolute path plus the newest `:line` suffix seen. */
  copy: z.string().optional(),
  /** Epoch ms of the newest message that mentioned it. */
  lastAt: z.number(),
  /** Sub-agent links only: the sub-agent whose message mentioned it last. */
  via: z.string().optional(),
  /** A local path (or webshare file) that no longer exists on the daemon machine. */
  missing: z.boolean().optional(),
  /** The newest mention's sentence as plain text, about 120 characters. */
  snippet: z.string().optional(),
  /**
   * Only when the link was mentioned with 2+ distinct full URLs: each of them, newest first.
   * `links.for-workspace` sends them for every URL link (1+) so the page can merge them across tabs;
   * the page's rows keep the 2+ rule.
   */
  variants: z.array(LinkVariantSchema).optional(),
});
export type Link = z.infer<typeof LinkSchema>;

export const linksForAgent = defineRpc({
  name: "links.for-agent",
  /** `subagents`: also list what the chat's sub-agents mentioned (costlier; the popover asks, the pill doesn't). */
  input: z.object({ agentId: z.string(), subagents: z.boolean().optional() }),
  output: z.object({
    /** `transcript`: read from the provider's file; `timeline`: fetched from the daemon. */
    source: z.enum(["transcript", "timeline", "none"]),
    /** Newest mention first, one row per link. */
    links: z.array(LinkSchema),
    /** Asked for only: links the sub-agents mentioned and this chat didn't, newest first, each with `via`. */
    subagentLinks: z.array(LinkSchema).optional(),
  }),
});

/** One tab (root agent) of a workspace and the links its chat mentioned. */
export const WorkspaceTabSchema = z.object({
  agentId: z.string(),
  /** The agent's title, else the first 8 characters of its id. */
  title: z.string(),
  /** Provider id (`omp`, `claude`, `omp-nilo` …), for the tab's provider mark. */
  provider: z.string(),
  /** A closed (archived) tab. */
  closed: z.boolean(),
  /** The tab's own links, newest first. */
  links: z.array(LinkSchema),
  /** Asked for only: links its sub-agents mentioned and the tab didn't, newest first, each with `via`. */
  subagentLinks: z.array(LinkSchema).optional(),
});
export type WorkspaceTab = z.infer<typeof WorkspaceTabSchema>;

export const linksForWorkspace = defineRpc({
  name: "links.for-workspace",
  /** `subagents`: also each tab's sub-agent links (the links page asks, the header button doesn't). */
  input: z.object({ workspaceId: z.string(), subagents: z.boolean().optional() }),
  output: z.object({
    /** The workspace's root agents, closed ones included; sub-agents are folded into their root. */
    tabs: z.array(WorkspaceTabSchema),
  }),
});
