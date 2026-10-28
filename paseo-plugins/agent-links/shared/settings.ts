import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const settings = defineSettings({
  id: "agent-links",
  scope: "host",
  version: 1,
  schema: z.object({ previews: z.boolean().default(false) }),
});

export const previewsOf = (values: unknown): boolean => settings.schema.parse(values).previews;
