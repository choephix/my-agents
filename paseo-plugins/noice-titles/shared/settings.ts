import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// When titles change without Stefan asking. Manual Retitle always works.
// `workspaces`: name a new workspace once its first tab has a subject.
// `provider`: which CLI asks the model; `ompModel`: the OMP model or `@role`;
// `timeout`: seconds a title request may take before the CLI is killed.
// A new field with a default needs no version bump: older documents parse unchanged.
export const OMP_DEFAULT_MODEL = "anthropic/claude-haiku-5-5";
export const settings = defineSettings({
  id: "automatic",
  scope: "host",
  version: 1,
  schema: z.object({
    automatic: z.enum(["off", "first", "every"]).default("first"),
    workspaces: z.boolean().default(true),
    provider: z.enum(["claude", "omp"]).default("claude"),
    ompModel: z.string().min(1).default(OMP_DEFAULT_MODEL),
    timeout: z.number().int().min(5).max(120).default(20),
  }),
});
export type Settings = z.output<typeof settings.schema>;
export type Automatic = Settings["automatic"];
export type Provider = Settings["provider"];
