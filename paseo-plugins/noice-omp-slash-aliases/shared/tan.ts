import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { SafeIdSchema } from "./btw";

/** OMP's id for a tangent's agent and its session file name: `Tan-<snowflake>`. */
export const TanIdSchema = z.string().regex(/^Tan-[A-Za-z0-9]{1,64}$/);

export const TanStatusSchema = z.enum(["running", "done", "failed", "stopped"]);
export type TanStatus = z.infer<typeof TanStatusSchema>;

/** One thing the tangent did: a tool call (`tool` set) or a sentence it wrote between tool calls. */
export const TanStepSchema = z.object({ tool: z.string().optional(), text: z.string() });
export type TanStep = z.infer<typeof TanStepSchema>;

export const TanStateSchema = z.object({
  tanId: TanIdSchema,
  /** What you asked for. */
  work: z.string(),
  /** Epoch milliseconds. */
  startedAt: z.number(),
  status: TanStatusSchema,
  /** Set once the tangent ended. */
  durationMs: z.number().optional(),
  /** The tangent's final answer (Markdown), or why it failed or stopped. */
  result: z.string(),
  /** Model id of the tangent's last reply, e.g. `claude-opus-5-5`. */
  model: z.string().optional(),
  /** Its newest steps, oldest first (capped). */
  steps: z.array(TanStepSchema),
});
export type TanState = z.infer<typeof TanStateSchema>;

/**
 * One tangent of a chat. `tanId` comes from OMP's dispatch record; for a live row
 * (Paseo's echo of the send) the tangent that started closest to `at` is used.
 */
export const tanStatus = defineRpc({
  name: "tan.status",
  input: z.object({ agentId: SafeIdSchema, tanId: TanIdSchema.optional(), at: z.number() }),
  output: z.object({ state: TanStateSchema.nullable() }),
});

