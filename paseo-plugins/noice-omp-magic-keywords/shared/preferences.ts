import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const STYLES = ["shimmer", "still", "off"] as const;
export type Style = (typeof STYLES)[number];
export const STYLE_NAMES: Record<Style, string> = { shimmer: "Moving colors", still: "Still colors", off: "Off" };

export const SCOPES = ["acting", "all"] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_NAMES: Record<Scope, string> = {
  acting: "Only where the words act",
  all: "Every chat",
};

export const preferences = defineSettings({
  id: "keywords",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Keywords in sent messages and in the chat outline's hover preview. */
    sent: z.enum(STYLES).default("shimmer"),
    /** Keywords in the text box while typing. */
    composer: z.enum(STYLES).default("shimmer"),
    scope: z.enum(SCOPES).default("acting"),
  }),
});
export type Preferences = z.output<typeof preferences.schema>;
