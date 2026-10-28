import { defineSettings, defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const preferences = defineSettings({
  id: "message-embeds",
  scope: "host",
  version: 1,
  schema: z.object({ enabled: z.boolean().default(true) }),
});

export type Preferences = z.output<typeof preferences.schema>;
export const DEFAULTS: Preferences = preferences.schema.parse({});
export type EmbedReadErrorCode = "missing" | "unreadable" | "binary" | "disallowed" | "too-large" | "invalid-range";

export const readEmbedFile = defineRpc({
  name: "message-embeds.read-file",
  input: z.object({
    agentId: z.string(),
    path: z.string(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
  }),
  output: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      path: z.string(),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
      text: z.string(),
      truncated: z.boolean(),
    }),
    z.object({
      status: z.literal("error"),
      code: z.enum(["missing", "unreadable", "binary", "disallowed", "too-large", "invalid-range"]),
      message: z.string(),
    }),
  ]),
});
