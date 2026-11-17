import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const modeSchema = z.enum(["fork", "full"]);
export const preferences = defineSettings({
  id: "context",
  scope: "host",
  version: 1,
  schema: z.object({ defaultMode: modeSchema.default("fork") }),
});

export const createSide = defineRpc({
  name: "create-side",
  input: z.object({ parentId: z.string().min(1), task: z.string().trim().default(""), mode: modeSchema.optional() }),
  output: z.object({ agentId: z.string(), mode: modeSchema }),
});

export const createTangent = defineRpc({
  name: "create-tangent",
  input: z.object({ parentId: z.string().min(1), task: z.string().trim().min(1) }),
  output: z.object({ agentId: z.string(), mode: modeSchema, title: z.string() }),
});

/** `folder` empty or the tab's own folder moves the agent itself; another folder continues it there. */
export const moveTab = defineRpc({
  name: "move-tab",
  input: z.object({ agentId: z.string().min(1), folder: z.string().trim().default(""), title: z.string().trim().default("") }),
  output: z.object({ agentId: z.string(), workspaceId: z.string(), how: z.enum(["moved", "fork", "full"]) }),
});
