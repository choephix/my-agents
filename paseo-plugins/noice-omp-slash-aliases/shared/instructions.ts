import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { SafeIdSchema } from "./btw";

/** The chat's instructions, `""` when it has none. */
export const instructionsGet = defineRpc({
  name: "instructions.get",
  input: z.object({ agentId: SafeIdSchema }),
  output: z.object({ text: z.string() }),
});

/** Replaces the chat's instructions; `""` clears them. */
export const instructionsSet = defineRpc({
  name: "instructions.set",
  input: z.object({ agentId: SafeIdSchema, text: z.string().max(100_000) }),
  output: z.object({}),
});
