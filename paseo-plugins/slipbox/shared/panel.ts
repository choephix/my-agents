import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { SLIP_KINDS } from "./frontmatter";

export const slipKindSchema = z.enum(SLIP_KINDS);

export const resolvedWikiTargetSchema = z.object({
  path: z.string(),
  relativePath: z.string(),
  wikiName: z.string(),
  isImage: z.boolean(),
  isMarkdown: z.boolean(),
  title: z.string().optional(),
  emoji: z.string().optional(),
  kind: z.string().optional(),
  settled: z.string().optional(),
  settledAs: z.string().optional(),
  previewMarkdown: z.string().optional(),
});

export const backlinkEntrySchema = z.object({
  path: z.string(),
  relativePath: z.string(),
  wikiName: z.string(),
  title: z.string(),
  emoji: z.string(),
  kind: z.string(),
  settled: z.string(),
});

export const resolveSlipContextRpc = defineRpc({
  name: "slips.context",
  input: z.object({
    filePath: z.string(),
    targets: z.array(z.string()).max(200),
    embedRequests: z
      .array(
        z.object({
          target: z.string(),
          fragment: z.string(),
        }),
      )
      .max(40)
      .optional(),
    includeBacklinks: z.boolean().optional(),
  }),
  output: z.object({
    boxFolder: z.string().nullable(),
    inBox: z.boolean(),
    relativePath: z.string().nullable(),
    folder: z.string().nullable(),
    wikiName: z.string().nullable(),
    resolved: z.record(z.string(), resolvedWikiTargetSchema),
    embedPreviews: z.record(z.string(), z.string()),
    backlinks: z.array(backlinkEntrySchema),
  }),
});

export const createSlipRpc = defineRpc({
  name: "slips.create",
  input: z.object({
    title: z.string().min(1),
    body: z.string().optional(),
    kind: slipKindSchema.optional(),
    emoji: z.string().optional(),
    about: z.string().optional(),
    from: z.string().optional(),
    agentId: z.string().optional(),
  }),
  output: z.object({
    absolutePath: z.string(),
    relativePath: z.string(),
    wikiName: z.string(),
    title: z.string(),
    kind: z.string(),
    emoji: z.string(),
  }),
});

export const SLIP_CREATED_TIMELINE_KIND = "slip-created";

export const slipCreatedTimelineSchema = z.object({
  absolutePath: z.string(),
  relativePath: z.string(),
  wikiName: z.string(),
  title: z.string(),
  kind: z.string(),
  emoji: z.string(),
});

export type SlipCreatedTimelineData = z.output<typeof slipCreatedTimelineSchema>;
