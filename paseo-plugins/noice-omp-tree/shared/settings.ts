import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Where the branch actions show. `showComposerPill`: the Tree pill above each OMP chat's composer
 * (off: it appears only while it hosts the branch sheet `/tree` opened, or a phone toast).
 * `showMessageButtons`: Continue / Re-ask icons on messages (web and desktop). `contextMenu`: the
 * branch menu on right-click (web and desktop; off leaves the browser's menu). `summarizeOnBack`:
 * Continue from here, Re-ask and switching branches summarize what is left at the branch point, as
 * OMP's `/tree` does with "Summarize" (off: move at once and offer "Summarize them" afterwards).
 * All on by default.
 */
export const displaySettings = defineSettings({
  id: "display",
  scope: "host",
  version: 1,
  schema: z.object({
    showComposerPill: z.boolean().default(true),
    showMessageButtons: z.boolean().default(true),
    contextMenu: z.boolean().default(true),
    summarizeOnBack: z.boolean().default(true),
  }),
});
export type TreeDisplay = z.output<typeof displaySettings.schema>;
export const DEFAULT_DISPLAY: TreeDisplay = displaySettings.schema.parse({});
