import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const SkillSchema = z.object({
  agentId: z.string(),
  /** OMP's session entry id. */
  id: z.string(),
  name: z.string(),
  /** The cut text the agent read after `User:` ("" when the message was only the token). */
  args: z.string(),
  /** The message as typed (Paseo's bubble while the chat is live). */
  prompt: z.string(),
});
export type SkillRecord = z.infer<typeof SkillSchema>;

const FileMentionSchema = z.object({
  agentId: z.string(),
  id: z.string(),
  /** The user message these files were attached after. */
  after: z.string(),
  files: z.array(z.object({ path: z.string(), lines: z.number() })),
});
export type FileMentionRecord = z.infer<typeof FileMentionSchema>;

/** Skills OMP loaded and files it attached, read from the OMP session files of the chats in view. */
export const skillMessages = defineRpc({
  name: "user-message-polish.skill-messages",
  input: z.object({ agentId: z.string().optional(), workspaceId: z.string().optional() }),
  output: z.object({
    /** OMP chats searched; 0 means no OMP chat here, so nothing can be judged. */
    searched: z.number(),
    skills: z.array(SkillSchema),
    files: z.array(FileMentionSchema),
  }),
});
export type SkillMessages = z.output<typeof skillMessages.output>;

/** What the agent received: a skill's wrapper (without the trailing `User:` line), or one attached file. */
export const skillBody = defineRpc({
  name: "user-message-polish.skill-body",
  input: z.object({ agentId: z.string(), id: z.string(), file: z.number().optional() }),
  output: z.object({ text: z.string().nullable() }),
});
