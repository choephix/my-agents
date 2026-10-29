import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { validateImage } from "./images";

export const preferences = defineSettings({
  id: "icons", scope: "host", version: 1,
  schema: z.object({
    // Installation binding used to avoid repainting equal provider ids from another host.
    hostId: z.string().max(200).optional(),
    mappings: z.array(z.object({
      provider: z.string().min(1).max(200),
      name: z.string().min(1).max(255),
      image: z.string().superRefine((value, ctx) => {
        const error = validateImage(value);
        if (error) ctx.addIssue({ code: "custom", message: error });
      }),
      style: z.enum(["original", "monochrome"]).default("original"),
    })).max(32).default([]),
  }).refine((value) => new Set(value.mappings.map((entry) => entry.provider)).size === value.mappings.length, "Each provider can have only one mapping."),
});
export type Preferences = z.output<typeof preferences.schema>;
