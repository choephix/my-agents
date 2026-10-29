import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * `showHeaderButton`: the links button in each workspace's header. `showComposerPill`: the
 * `N links` pill in each chat's composer. Both on by default.
 */
export const headerSettings = defineSettings({
  id: "header",
  scope: "host",
  version: 1,
  schema: z.object({
    showHeaderButton: z.boolean().default(true),
    showComposerPill: z.boolean().default(true),
  }),
});

/** Where webshare files live unless configured; `~` is the daemon user's home. */
export const DEFAULT_WEBSHARE_FOLDER = "~/www/webshare";

/**
 * `origin`: the webshare's public HTTP(S) origin; empty leaves webshare paths as local files.
 * `folder`: the folder that origin serves (`~` is the daemon user's home; empty means the default).
 * The server reads both on every request and starts a fresh links cache when they change.
 */
export const webshareSettings = defineSettings({
  id: "webshare",
  scope: "host",
  version: 1,
  schema: z.object({
    origin: z.union([z.literal(""), z.string().url()]).default(""),
    folder: z.string().default(DEFAULT_WEBSHARE_FOLDER),
  }),
});
