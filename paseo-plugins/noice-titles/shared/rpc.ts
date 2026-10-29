import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// A manual retitle always ends in a new title or a reason why not.
const result = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("renamed"), title: z.string(), previous: z.string().nullable() }),
  z.object({ outcome: z.literal("failed"), message: z.string() }),
]);
export type RetitleResult = z.infer<typeof result>;

export const retitle = defineRpc({ name: "retitle", input: z.object({ agentId: z.string().min(1) }), output: result });
export const retitleWorkspace = defineRpc({ name: "retitle-workspace", input: z.object({ workspaceId: z.string().min(1) }), output: result });
