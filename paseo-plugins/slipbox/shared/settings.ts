import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const slipboxSettings = defineSettings({
  id: "slipbox",
  scope: "host",
  version: 1,
  schema: z.object({
    /**
     * Absolute path (or `~/...`) of the slip-box folder on this host.
     * When empty, falls back to `SLIPBOX_DIR` or `~/.config/slipbox-desk/settings.json`.
     */
    boxFolder: z.string().default(""),
    /** Include `captures/` slips in attachment search results. */
    includeCaptures: z.boolean().default(true),
    /** Include `scraps/` and `efforts/` notes in attachment search results. */
    includeAgentNotes: z.boolean().default(true),
    /** Include settled slips (front matter `settled:`) in attachment search results. */
    includeSettled: z.boolean().default(true),
  }),
});

export type SlipboxSettings = z.output<typeof slipboxSettings.schema>;
export const DEFAULT_SETTINGS: SlipboxSettings = slipboxSettings.schema.parse({});

export const boxStatusRpc = defineRpc({
  name: "slipbox.status",
  input: z.object({}),
  output: z.object({
    folder: z.string().nullable(),
    source: z.enum(["setting", "env", "desk-config", "none"]),
    exists: z.boolean(),
    slipCount: z.number().int().nonnegative(),
  }),
});
