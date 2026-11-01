import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** How long armed instructions wait for the workspace's next chat. */
export const ARM_MS = 30 * 60_000;

/** Workspaces with armed instructions; `expiresAt` in epoch milliseconds. */
export const nextChatArmed = defineRpc({
  name: "next-chat.armed",
  input: z.object({}),
  output: z.object({ armed: z.array(z.object({ workspaceId: z.string(), expiresAt: z.number() })) }),
});

/** One workspace's armed text and the chat that last took instructions from it. */
export const nextChatGet = defineRpc({
  name: "next-chat.get",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({
    armed: z.object({ text: z.string(), expiresAt: z.number() }).nullable(),
    lastUsed: z.object({ agentId: z.string(), title: z.string().nullable(), text: z.string(), at: z.number() }).nullable(),
  }),
});

/** Arms the text for the workspace's next chat (for 30 minutes); `""` disarms. */
export const nextChatSet = defineRpc({
  name: "next-chat.set",
  input: z.object({ workspaceId: z.string(), text: z.string().max(100_000) }),
  output: z.object({ expiresAt: z.number().nullable() }),
});
