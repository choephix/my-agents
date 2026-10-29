import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_ALWAYS_FOLD = "attachments, system-notice, system-reminder";
export const DEFAULT_NEVER_FOLD = "div, span, p, br, b, i, em, strong, u, s, a, img, code, pre, kbd, details, table, ul, ol, li";

export const preferences = defineSettings({
  id: "polish",
  scope: "host",
  version: 1,
  schema: z.object({
    foldTags: z.boolean().default(true),
    markdown: z.boolean().default(true),
    commands: z.boolean().default(true),
    skills: z.boolean().default(true),
    alwaysFold: z.string().default(DEFAULT_ALWAYS_FOLD),
    neverFold: z.string().default(DEFAULT_NEVER_FOLD),
  }),
});
export type Preferences = z.output<typeof preferences.schema>;
export const DEFAULTS: Preferences = preferences.schema.parse({});

/** "a, b  c" → lower-case tag names. */
export function tagList(text: string): Set<string> {
  return new Set(text.split(/[\s,]+/).map((tag) => tag.trim().toLowerCase()).filter(Boolean));
}
