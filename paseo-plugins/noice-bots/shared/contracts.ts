import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const PLUGIN_ID = "noice-bots";
export const PROVIDER_ID = "bots";
/** On the hub agent: its bot. The sidebar lists hubs by ROLE_LABEL = "hub". */
export const HUB_LABEL = "noice-bots.hub";
export const ROLE_LABEL = "noice-bots.role";
/** On the hub agent: `<running>,<unread>`, so the sidebar needs no polling. */
export const COUNTS_LABEL = "noice-bots.counts";
export const EMOJI_LABEL = "noice-bots.emoji";
/** On a thread agent: its bot. */
export const THREAD_LABEL = "noice-bots.thread";
export const THREAD_KIND = "bots-thread";

export const settings = defineSettings({
  id: "bots",
  scope: "host",
  version: 1,
  schema: z.object({
    showRobot: z.boolean().default(true),
    maxRunning: z.number().int().min(1).max(32).default(4),
    readOnlyDays: z.number().int().min(1).max(365).default(7),
    /** A bot left without a folder works in `<this>/<name>`. */
    botsFolder: z.string().trim().min(1).default("~/bots"),
  }),
});

export const ThreadStatus = z.enum(["queued", "running", "done", "failed", "stopped"]);
export const Thread = z.object({
  id: z.string(),
  botId: z.string(),
  /** The question's first line, until the thread names itself (`thread_progress`'s `title`). */
  title: z.string(),
  /** The thread chose `title` itself. */
  named: z.boolean().optional(),
  question: z.string(),
  answer: z.string(),
  status: ThreadStatus,
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  followUps: z.number(),
  note: z.string(),
  unread: z.boolean(),
  /** Agent deleted after N days: saved copy only, no Wake. */
  readOnly: z.boolean(),
  /** Its chat was opened (Open on a running block, or Wake): no sleep at turn end until its tab closes. */
  awake: z.boolean().optional(),
  workspaceId: z.string(),
  /** The hub's model, thinking and mode when the thread was asked. */
  model: z.string().optional(),
  thinking: z.string().optional(),
  mode: z.string().optional(),
  /** Images and files sent with the question, on disk; the thread is told their paths and sees the images. */
  files: z.array(z.string()).optional(),
});
export type Thread = z.infer<typeof Thread>;

export const Message = z.object({ role: z.enum(["user", "assistant"]), text: z.string() });
export type Message = z.infer<typeof Message>;

/** Name, emoji and folder may be left empty: the server fills them in (`defaultName`, `defaultFolder`). */
export const BotInput = z.object({
  name: z.string().trim().max(60),
  emoji: z.string().trim().max(16),
  cwd: z.string().trim(),
  prompt: z.string(),
  /** Threads run on OMP or a provider that extends it (they need its system prompt and session folder). */
  provider: z.string().trim().default("omp"),
});
export type BotInput = z.infer<typeof BotInput>;

const ANIMALS: Record<string, string> = { "🦊": "Fox", "🐱": "Cat", "🐼": "Panda", "🐸": "Frog", "🐻": "Bear", "🦁": "Lion", "🐨": "Koala", "🐯": "Tiger", "🐵": "Monkey", "🐺": "Wolf" };
export const defaultName = (emoji: string) => ANIMALS[emoji] ?? "Bot";
export const defaultFolder = (root: string, name: string) => `${root.replace(/\/+$/, "")}/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bot"}`;
export const Bot = BotInput.extend({
  id: z.string(), workspaceId: z.string(), hubAgentId: z.string(), createdAt: z.number(),
  /** Threads that changed while the hub was closed: it redraws their blocks when it opens. */
  redraw: z.array(z.string()).optional(),
  /** The last day whose threads are all read-only. */
  sweptThrough: z.string().optional(),
});
export type Bot = z.infer<typeof Bot>;

export const createBot = defineRpc({ name: "bots.create", input: BotInput, output: z.object({ hubAgentId: z.string() }) });
export const updateBot = defineRpc({ name: "bots.update", input: BotInput.extend({ id: z.string() }), output: z.object({}) });
export const getBot = defineRpc({ name: "bots.get", input: z.object({ id: z.string() }), output: Bot.extend({ threads: z.number() }).nullable() });
export const deleteBot = defineRpc({ name: "bots.delete", input: z.object({ id: z.string() }), output: z.object({}) });
const RpcThread = z.object({ thread: Thread, bot: z.object({ name: z.string(), emoji: z.string() }), messages: z.array(Message) });
export type RpcThread = z.infer<typeof RpcThread>;
export const getThread = defineRpc({ name: "bots.thread", input: z.object({ id: z.string(), markRead: z.boolean() }), output: RpcThread.nullable() });
export const wakeThread = defineRpc({ name: "bots.wake", input: z.object({ id: z.string() }), output: z.object({}) });
export const searchThreads = defineRpc({
  name: "bots.search",
  input: z.object({ botId: z.string(), query: z.string().trim().min(2) }),
  output: z.array(Thread),
});
export const markAllRead = defineRpc({ name: "bots.mark-read", input: z.object({ botId: z.string() }), output: z.object({}) });
/** Unread threads newest first, over the days the sidebar's green dot counts. */
export const listUnread = defineRpc({ name: "bots.unread", input: z.object({ botId: z.string() }), output: z.array(Thread) });
/** The user opened a thread's chat: it stays up after its turn until the tab is closed. */
export const openedThread = defineRpc({ name: "bots.opened", input: z.object({ id: z.string() }), output: z.object({}) });
/** OMP and the providers that extend it, enabled on this daemon: what a bot's threads can run on. */
export const listProviders = defineRpc({ name: "bots.providers", input: z.object({}), output: z.array(z.object({ id: z.string(), label: z.string() })) });
