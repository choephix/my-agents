import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * One /btw answer as the OMP extension `headless-builtins` writes it to
 * `$PASEO_HOME/omp-btw/<agentId>/<id>.json` (see its btw-outbox.ts; keep in sync).
 * `interrupted` is added by this plugin for a running answer whose OMP process stopped writing.
 */
export const BtwStatusSchema = z.enum(["running", "complete", "cancelled", "error", "interrupted"]);
export type BtwStatus = z.infer<typeof BtwStatusSchema>;

export const BtwEntrySchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  status: BtwStatusSchema,
  error: z.string().optional(),
  /** Epoch milliseconds. */
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type BtwEntry = z.infer<typeof BtwEntrySchema>;

export const BtwFileSchema = z.object({
  version: z.literal(1),
  agentId: z.string(),
  record: BtwEntrySchema,
});

/** Paseo agent ids and OMP record ids; also keeps them safe as file names. */
export const SafeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);

export const BtwChatSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  count: z.number(),
  running: z.boolean(),
  /** Newest entry's updatedAt, so clients refetch a chat's answers only when it changed. */
  updatedAt: z.number(),
});
export type BtwChat = z.infer<typeof BtwChatSchema>;

/** Every chat on this daemon that has undismissed /btw answers. */
export const btwChats = defineRpc({
  name: "btw.chats",
  input: z.object({}),
  output: z.object({ chats: z.array(BtwChatSchema) }),
});

/** One chat's undismissed answers, newest first. */
export const btwList = defineRpc({
  name: "btw.list",
  input: z.object({ agentId: SafeIdSchema }),
  output: z.object({ entries: z.array(BtwEntrySchema) }),
});

/** Sends the question to the chat's OMP agent, if that agent can answer it out of band. */
export const btwAsk = defineRpc({
  name: "btw.ask",
  input: z.object({ agentId: SafeIdSchema, question: z.string().min(1) }),
  output: z.object({}),
});

/** Hides an answer on every client; a running answer is cancelled. */
export const btwDismiss = defineRpc({
  name: "btw.dismiss",
  input: z.object({ agentId: SafeIdSchema, id: SafeIdSchema }),
  output: z.object({}),
});
