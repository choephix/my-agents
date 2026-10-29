import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Most commits the server sends per effort; `commitsShown` can't go above it. */
export const MAX_COMMITS = 100;
/** The choices on the settings screen; any whole number from 10 to `MAX_COMMITS` parses. */
export const COMMITS_SHOWN_CHOICES = [10, 30, 50, 100] as const;

/**
 * `extraFolders`: folders scanned besides the `.scratch` of Paseo's workspaces: a `.scratch`
 * folder itself or a folder that holds one (`~/workspace/acme-app`). `~` is the daemon user's
 * home. `showHeaderButton`: the effort pill in each workspace's header. `showComposerPill`: the
 * effort pill above each chat's composer on compact layouts; off by default.
 * `excludedFolders`: folders whose descendants are skipped unless explicitly listed as extras.
 * `commitsShown`: how many of the effort's newest commits Files & commits lists (the server sends
 * at most `MAX_COMMITS`).
 */
export const folderSettings = defineSettings({
  id: "folders",
  scope: "host",
  version: 1,
  schema: z.object({
    extraFolders: z.array(z.string()).default([]),
    showHeaderButton: z.boolean().default(true),
    showComposerPill: z.boolean().default(false),
    excludedFolders: z.array(z.string()).default([]),
    commitsShown: z.number().int().min(10).max(MAX_COMMITS).default(30),
  }),
});
