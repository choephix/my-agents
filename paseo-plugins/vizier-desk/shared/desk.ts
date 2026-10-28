import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// The shape of Axalon Mainframe's /desk.json (its pages/desk-json.ts).

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
export const KINDS = ["asks", "doing", "endeavors"] as const;
export const PR_STATES = ["merged", "ready", "open", "conflict", "closed", "draft", "unknown"] as const;

const card = z.object({
  kind: z.enum(KINDS),
  name: z.string(),
  file: z.string(),
  url: z.string(),
  status: z.string(),
  priority: z.enum(PRIORITIES).nullable(),
  effort: z.string().nullable(),
  /** Key into `workspaces`. */
  workspace: z.string(),
  live: z.boolean(),
  closed: z.boolean(),
  quiet: z.boolean(),
  broken: z.boolean(),
  opened: z.string().nullable(),
  updated: z.string().nullable(),
  title: z.string(),
  now: z.string().nullable(),
  blocks: z.string().nullable(),
  answer: z.string().nullable(),
  body: z.string(),
  prs: z.array(z.number()),
  asks: z.array(z.string()),
  links: z.array(z.string()),
  asker: person.nullable(),
  watchers: z.array(person),
  sessions: z.array(person),
});

export const deskSchema = z.object({
  at: z.string(),
  repo: z.string(),
  githubFetchedAt: z.string().nullable(),
  /** Local folders a web server shares: [path prefix, URL prefix]. Turns a link written as a local path into one that opens. */
  shared: z.array(z.tuple([z.string(), z.string()])),
  workspaces: z.array(z.object({ key: z.string(), title: z.string(), hue: z.number() })),
  /** `owner/repo#number` → state. */
  prs: z.record(z.string(), z.object({ state: z.enum(PR_STATES), words: z.string(), title: z.string() })),
  cards: z.array(card),
});

export type Desk = z.infer<typeof deskSchema>;
export type DeskCard = Desk["cards"][number];
export type DeskPerson = z.infer<typeof person>;
export type Priority = (typeof PRIORITIES)[number];
export type Kind = (typeof KINDS)[number];
export type PrState = (typeof PR_STATES)[number];

export const deskRead = defineRpc({
  name: "desk.read",
  input: z.object({}),
  output: deskSchema,
});
