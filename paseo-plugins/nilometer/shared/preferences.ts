import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const preferences = defineSettings({
  id: "nilometer",
  scope: "host",
  version: 1,
  schema: z.object({ token: z.string().default("") }),
});
export type Preferences = z.output<typeof preferences.schema>;
export const DEFAULTS: Preferences = preferences.schema.parse({});

export const inboxWrite = defineRpc({
  name: "inbox.write",
  input: z.object({
    action: z.enum(["settle", "answer", "star"]),
    name: z.string(),
    token: z.string(),
    outcome: z.string().optional(),
    reply: z.string().optional(),
    answerId: z.string().optional(),
  }),
  output: z.object({ ok: z.boolean(), name: z.string(), starred: z.boolean().optional(), settled: z.boolean().optional(), sendError: z.string().nullable().optional(), watcherErrors: z.array(z.string()).optional(), error: z.string().optional() }),
});