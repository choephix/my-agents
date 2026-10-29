import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// The shape returned by Axalon Mainframe's /desk.json.

const person = z.object({
  tab: z.string().nullable(),
  agentId: z.string().nullable(),
  /** The Paseo tab's title, null when the tab is gone. */
  name: z.string().nullable(),
  /** The tab's last status (running, idle, error, …), or `gone`. */
  status: z.string(),
  omp: z.string().nullable(),
  provider: z.string().nullable(),
  cwd: z.string().nullable(),
  why: z.string().nullable(),
});

export const PRIORITIES = ["blocking", "revisit", "whenever"] as const;
export const KINDS = ["inbox", "doing"] as const;
export const PR_STATES = ["merged", "ready", "open", "conflict", "closed", "draft", "unknown"] as const;
export const MEMO_KINDS = ["revisit", "go", "ask", "notice", "parked", "musing"] as const;

const cardFields = {
  name: z.string(),
  url: z.string(),
  workspace: z.string(),
  settled: z.boolean(),
  priority: z.string().nullable(),
  blocks: z.string().nullable(),
  body: z.string(),
  title: z.string(),
  now: z.string().nullable().optional(),
  answers: z.array(z.object({ label: z.string(), reply: z.string() })),
  hashtags: z.array(z.string()),
  starred: z.boolean(),
  links: z.array(z.string()),
  prs: z.array(z.number()),
  asker: person.nullable(),
  watchers: z.array(person),
  sessions: z.array(person),
  memoKind: z.string().nullable().optional(),
};

const inboxCard = z.object({
  ...cardFields,
  kind: z.literal("inbox"),
  status: z.string(),
});

const doingCard = z.object({
  ...cardFields,
  kind: z.literal("doing"),
  memos: z.array(z.string()),
});

export const deskSchema = z.object({
  /** Milliseconds are not part of the new contract; this is retained when Mainframe supplies it. */
  at: z.string().optional(),
  repo: z.string().default(""),
  githubFetchedAt: z.string().nullable().optional(),
  /** Local folders a web server shares: [path prefix, URL prefix]. */
  shared: z.array(z.tuple([z.string(), z.string()])),
  workspaces: z.array(z.object({ key: z.string(), title: z.string(), hue: z.number() })),
  /** `owner/repo#number` → state. */
  prs: z.record(z.string(), z.object({ state: z.enum(PR_STATES), words: z.string(), title: z.string() })),
  inbox: z.array(inboxCard),
  doing: z.array(doingCard),
});

export type Desk = z.infer<typeof deskSchema>;
export type InboxCard = z.infer<typeof inboxCard>;
export type DoingCard = z.infer<typeof doingCard>;
export type DeskCard = InboxCard | DoingCard;
export type DeskPerson = z.infer<typeof person>;
export type Priority = (typeof PRIORITIES)[number];
export type Kind = (typeof KINDS)[number];
export type PrState = (typeof PR_STATES)[number];

export const deskRead = defineRpc({
  name: "desk.read",
  input: z.object({}),
  output: deskSchema,
});
