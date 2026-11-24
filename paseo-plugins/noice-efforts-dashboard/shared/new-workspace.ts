import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { EffortSummarySchema } from "./rpc";

/** Workspace metadata key carrying the effort chosen on the New workspace screen. */
export const NEW_WORKSPACE_EFFORT_KEY = "noice-efforts-dashboard.effort";

export const NewWorkspaceEffortSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("effort"),
    root: z.string().min(1),
    slug: z.string().min(1),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("none"),
  }),
]);
export type NewWorkspaceEffort = z.infer<typeof NewWorkspaceEffortSchema>;

/** Reads the plugin's effort choice from a workspace's metadata, returning null if absent or invalid. */
export function parseNewWorkspaceEffort(metadata: Readonly<Record<string, unknown>> | null | undefined): NewWorkspaceEffort | null {
  if (!metadata || !(NEW_WORKSPACE_EFFORT_KEY in metadata)) return null;
  const parsed = NewWorkspaceEffortSchema.safeParse(metadata[NEW_WORKSPACE_EFFORT_KEY]);
  return parsed.success ? parsed.data : null;
}

export const ProjectEffortSchema = EffortSummarySchema.extend({
  /** Folder holding `.scratch` (`acme-app`), shown when a project spans multiple roots. */
  rootLabel: z.string(),
});
export type ProjectEffort = z.infer<typeof ProjectEffortSchema>;

/** Lists and filters efforts belonging to a single project for the New workspace effort picker. */
export const projectEffortsRpc = defineRpc({
  name: "efforts.project",
  input: z.object({
    projectId: z.string(),
    query: z.string().optional(),
  }),
  output: z.object({
    hasEfforts: z.boolean(),
    rootCount: z.number(),
    efforts: z.array(ProjectEffortSchema),
  }),
});
