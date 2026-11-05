import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** What an entry reports. An agent has at most one entry of each kind; a newer one replaces it. */
export const kindSchema = z.enum(["finished", "error", "permission"]);
export type Kind = z.infer<typeof kindSchema>;

export const entrySchema = z.object({
  agentId: z.string(),
  kind: kindSchema,
  /** The agent's title when the entry was made; the app shows the live title when it has one. */
  title: z.string(),
  /** The start of the final reply, the error message, or what the permission is for. */
  preview: z.string(),
  /** Epoch milliseconds. */
  at: z.number(),
  read: z.boolean(),
});
export type Entry = z.infer<typeof entrySchema>;

const refSchema = z.object({ agentId: z.string(), kind: kindSchema });
export type EntryRef = z.infer<typeof refSchema>;
export const entryKey = (entry: EntryRef) => `${entry.agentId}:${entry.kind}`;

/** Every call answers with the whole list, newest first. */
const listSchema = z.object({ entries: z.array(entrySchema) });

export const inboxList = defineRpc({ name: "inbox.list", input: z.object({}), output: listSchema });
export const inboxMarkRead = defineRpc({
  name: "inbox.mark-read",
  input: z.object({ items: z.array(refSchema) }),
  output: listSchema,
});
/** Removes the given entries, or every entry when `items` is omitted. */
export const inboxClear = defineRpc({
  name: "inbox.clear",
  input: z.object({ items: z.array(refSchema).optional() }),
  output: listSchema,
});
