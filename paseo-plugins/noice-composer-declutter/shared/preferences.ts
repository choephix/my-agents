import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const preferences = defineSettings({
  id: "controls",
  scope: "host",
  version: 1,
  schema: z.object({
    hideThinking: z.boolean().default(false),
    hideMode: z.boolean().default(false),
    hideFastMode: z.boolean().default(false),
    hideOtherFeatures: z.boolean().default(false),
    hideDictation: z.boolean().default(false),
    hideVoice: z.boolean().default(false),
  }),
});
export type Preferences = z.output<typeof preferences.schema>;
