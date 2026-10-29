import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DensitySchema = z.enum(["comfortable", "compact"]);
export type Density = z.infer<typeof DensitySchema>;

/**
 * View preferences, saved on the host so they survive app reloads and other windows see them.
 * `density`: list rows. `showHeaderButton`: the History button in each workspace's header.
 */
export const viewSettings = defineSettings({
  id: "view",
  scope: "host",
  version: 1,
  schema: z.object({
    density: DensitySchema.default("comfortable"),
    showHeaderButton: z.boolean().default(true),
  }),
});
