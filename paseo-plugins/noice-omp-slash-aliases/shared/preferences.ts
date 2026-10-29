import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const preferences = defineSettings({
  id: "commands",
  scope: "host",
  version: 1,
  schema: z.object({
    /** The `/tan` composer alias. Off: not offered; existing /tan rows still render. */
    tan: z.boolean().default(false),
  }),
});
export type Preferences = z.output<typeof preferences.schema>;
export const DEFAULTS: Preferences = preferences.schema.parse({});
