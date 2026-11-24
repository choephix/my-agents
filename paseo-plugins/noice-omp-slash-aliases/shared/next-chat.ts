import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Agent metadata key carrying per-draft system instructions to `agent.create.before`. */
export const INSTRUCTIONS_METADATA_KEY = "noice-omp-slash-aliases.instructions";

/** Built-in providers whose Paseo adapters pass per-agent `systemPrompt` through. */
export const SYSTEM_PROMPT_PROVIDERS = ["omp", "claude", "codex", "opencode", "pi"] as const;

/** The chat that most recently used custom instructions on this host. */
export const nextChatLastUsed = defineRpc({
  name: "next-chat.last-used",
  input: z.object({}),
  output: z.object({
    lastUsed: z
      .object({
        agentId: z.string(),
        title: z.string().nullable(),
        text: z.string(),
        at: z.number(),
      })
      .nullable(),
  }),
});
