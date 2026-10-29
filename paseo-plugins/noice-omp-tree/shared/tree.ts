import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { displaySettings } from "./settings";

/** Paseo agent ids, OMP entry ids and request ids. */
const IdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);

/** One turn on the chat's current path: a user message and what followed until the next one. */
export const TurnSchema = z.object({
  /** OMP entry id of the user message; null for a turn that starts without one. */
  userId: z.string().nullable(),
  userText: z.string().nullable(),
  /** Epoch ms of the user message. */
  userTime: z.number().nullable(),
  /** Last assistant or tool-result entry of the turn ("Continue from here" goes there); null while unanswered. */
  lastId: z.string().nullable(),
  /** Start of the turn's last assistant text (the reply above Paseo's footer); null when it has none. */
  replyText: z.string().nullable(),
});
export type Turn = z.infer<typeof TurnSchema>;

export const BranchSchema = z.object({
  /** Entry to move to when switching; null for the new branch you are on that has no messages yet. */
  target: z.string().nullable(),
  /** First message where this branch went its own way. */
  title: z.string(),
  /** Epoch ms of the branch's newest message. */
  time: z.number().nullable(),
  messages: z.number(),
  current: z.boolean(),
  summarized: z.boolean(),
  pending: z.boolean(),
});
export type Branch = z.infer<typeof BranchSchema>;

export const OpKindSchema = z.enum(["continue", "reask", "switch", "undo", "summarize"]);
export type OpKind = z.infer<typeof OpKindSchema>;

export const OpSchema = z.object({
  id: z.string(),
  kind: OpKindSchema,
  phase: z.enum(["switching", "summarizing", "reloading"]),
  startedAt: z.number(),
  focus: z.string().optional(),
});
export type Op = z.infer<typeof OpSchema>;

export const OutcomeSchema = z.object({
  id: z.string(),
  kind: OpKindSchema,
  status: z.enum(["done", "cancelled", "error"]),
  error: z.string().optional(),
  finishedAt: z.number(),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

export const TreeStateSchema = z.object({
  /** OMP chat with a session file. Everything is hidden when false. */
  supported: z.boolean(),
  /** False when the chat's OMP process started before the session-tree extension was installed. */
  ready: z.boolean(),
  busy: z.boolean(),
  turns: z.array(TurnSchema),
  branches: z.array(BranchSchema),
  /**
   * After going back: how many messages were left, until the next send or ×. `summarized`: a branch
   * summary of them already sits at the branch point (no "Summarize them" any more).
   */
  offer: z.object({ markerId: z.string(), setAside: z.number(), summarized: z.boolean() }).nullable(),
  op: OpSchema.nullable(),
  last: OutcomeSchema.nullable(),
});
export type TreeState = z.infer<typeof TreeStateSchema>;

export const ChatSummarySchema = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  branches: z.number(),
  offer: z.number().nullable(),
  phase: OpSchema.shape.phase.nullable(),
});
export type ChatSummary = z.infer<typeof ChatSummarySchema>;

/** Every OMP chat on this daemon, with its branch count, and the plugin's display settings. */
export const treeChats = defineRpc({
  name: "tree.chats",
  input: z.object({}),
  output: z.object({ chats: z.array(ChatSummarySchema), display: displaySettings.schema }),
});

export const treeState = defineRpc({
  name: "tree.state",
  input: z.object({ agentId: IdSchema }),
  output: TreeStateSchema,
});

/**
 * Moves the chat: Continue from here (assistant), Re-ask (user), Switch (branch list), Undo. Returns at once; follow `op`.
 * `summarize`: OMP summarizes the branch being left at the branch point during the move (not for Undo).
 */
export const treeGoto = defineRpc({
  name: "tree.goto",
  input: z.object({
    agentId: IdSchema, target: IdSchema.optional(), kind: z.enum(["continue", "reask", "switch", "undo"]), summarize: z.boolean().optional(),
  }),
  output: z.object({ opId: z.string() }),
});

/** Summarizes the set-aside messages into a branch summary at the branch point. */
export const treeSummarize = defineRpc({
  name: "tree.summarize",
  input: z.object({ agentId: IdSchema, focus: z.string().max(2000) }),
  output: z.object({ opId: z.string() }),
});

export const treeCancel = defineRpc({
  name: "tree.cancel",
  input: z.object({ agentId: IdSchema }),
  output: z.object({}),
});

/** Hides the "set aside" offer on every client. */
export const treeDismiss = defineRpc({
  name: "tree.dismiss",
  input: z.object({ agentId: IdSchema }),
  output: z.object({}),
});

/** Copies the chat up to an entry into a new OMP session and opens it as a new agent. */
export const treeOpenTab = defineRpc({
  name: "tree.open-tab",
  /** `before`: stop at the entry's parent (a user message is left out, to be re-asked). */
  input: z.object({ agentId: IdSchema, entryId: IdSchema, before: z.boolean() }),
  output: z.object({ agentId: z.string() }),
});

/** The text behind a replayed "[branch_summary]" row. */
export const treeSummary = defineRpc({
  name: "tree.summary",
  input: z.object({ agentId: IdSchema, callId: z.string().max(200) }),
  output: z.object({ summary: z.string().nullable(), focus: z.string().nullable() }),
});

/** Timeline item that replaces Paseo's "[branch_summary] Unsupported history record" row. */
export const SUMMARY_KIND = "branch-summary";
export const SummaryItemSchema = z.object({ callId: z.string() });
