import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** One switch per tweak, all on by default (the tweaks were always on before they had switches). */
export const preferences = defineSettings({
  id: "tweaks",
  scope: "host",
  version: 1,
  schema: z.object({
    compactSidebar: z.boolean().default(true),
    fileWrap: z.boolean().default(true),
    linkColours: z.boolean().default(true),
  }),
});
export type Preferences = z.output<typeof preferences.schema>;
export type TweakId = keyof Preferences;
