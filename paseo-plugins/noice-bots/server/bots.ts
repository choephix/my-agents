import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { ProviderEvent, ProviderSessionConfig } from "@getpaseo/plugin/server/provider";
import {
  COUNTS_LABEL, defaultFolder, defaultName, EMOJI_LABEL, HUB_LABEL, PLUGIN_ID, PROVIDER_ID, ROLE_LABEL, THREAD_KIND, THREAD_LABEL,
  type Bot, type BotInput, type Message, type Thread,
} from "../shared/contracts";
import { daemon, daemonAtStart, paseoHome } from "./daemon";
import { dayOf, mediaDir, sessionsDir, Store } from "./store";

export interface Limits { maxRunning: number; readOnlyDays: number; botsFolder: string }

/** `agentId`: the hub agent the session belongs to. `ready`: Paseo listens, so rows can be drawn. */
interface HubSession { botId: string; agentId: string; emit(event: ProviderEvent): void; config: ProviderSessionConfig; ready: boolean }
/** What came with a hub message besides its text. */
export interface Attached { images: { data: string; mimeType: string }[]; files: string[] }

const PROGRESS_HINT = "\n\nWhile you work on something that takes more than a few steps, call thread_progress with a few words on what you are doing."
  + " On your first thread_progress call, also set title: 2-5 words naming what this thread is about.";
/** Images a thread sees as well as gets the path of, by file extension. */
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const extensionOf = (mimeType: string) => mimeType.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9].*$/, "") || "bin";
/** Characters of the first answer kept on the hub's row. */
const ANSWER_LIMIT = 1500;
/** Bots start on this; the hub's model and thinking pickers change it. */
export const DEFAULT_MODEL = "anthropic/claude-opus-5-5";
export const DEFAULT_THINKING = "high";

/** Threads, their bots and the hub chats that show them. */
export class Bots {
  readonly store = new Store();
  readonly #hubs = new Map<string, HubSession>();
  /** Queued and running threads, by id. */
  readonly #active = new Map<string, Thread>();
  /** Bots whose hub session is being reopened. */
  readonly #reopening = new Set<string>();
  readonly #countTimers = new Map<string, NodeJS.Timeout>();
  #sweeper: NodeJS.Timeout | undefined;
  /** Hub sessions can open before `load` is done; they wait for the bots file. */
  #storeLoaded: Promise<void> | undefined;

  constructor(private readonly limits: () => Promise<Limits>) {}

  async load(): Promise<void> {
    this.#storeLoaded = this.store.load();
    await this.#storeLoaded;
    const { readOnlyDays } = await this.limits();
    for (const bot of this.store.bots) {
      for (const day of (await this.store.days(bot.id)).slice(-readOnlyDays)) {
        for (const thread of await this.store.day(bot.id, day)) {
          if (thread.status === "queued" || thread.status === "running") this.#active.set(thread.id, thread);
        }
      }
    }
    // Turns that ended while this process was down.
    const client = await daemonAtStart();
    if (!client) return;
    for (const thread of [...this.#active.values()].filter(thread => thread.status === "running")) {
      const agent = (await client.fetchAgent(thread.id).catch(() => null))?.agent;
      if (agent?.status === "running" || agent?.status === "initializing") continue;
      await this.turnEnded(thread.id, thread.workspaceId, agent?.status === "error" ? "failed" : "done").catch(error => console.error(`noice-bots: finishing ${thread.id} failed`, error));
    }
    for (const bot of this.store.bots) void this.#schedule(bot.id);
    void this.sweep();
    this.#sweeper = setInterval(() => void this.sweep(), 3_600_000);
  }

  // ---------------------------------------------------------------- bots

  /** One create at a time, so a repeat of the same form sees the bot the first one made. */
  #creating: Promise<unknown> = Promise.resolve();
  createBot(raw: BotInput): Promise<Bot> {
    const run = this.#creating.then(() => this.#createBot(raw));
    this.#creating = run.catch(() => undefined);
    return run;
  }

  async #createBot(raw: BotInput): Promise<Bot> {
    const input = await this.#complete(raw);
    // The same form sent again within a few minutes (a second tap, or a retry whose first answer
    // never showed) gets the bot already made.
    const same = this.store.bots.find(bot => Date.now() - bot.createdAt < 300_000 && bot.name === input.name && bot.emoji === input.emoji
      && bot.cwd === input.cwd && bot.prompt === input.prompt && bot.provider === input.provider);
    if (same) return same;
    const client = await daemon();
    const id = randomUUID();
    const created = await client.createWorkspace({ source: { kind: "directory", path: input.cwd }, background: true, title: `${input.emoji} ${input.name}` });
    if (!created.workspace) throw new Error(created.error ?? "Creating the bot's workspace failed");
    const bot: Bot = { ...input, id, workspaceId: created.workspace.id, hubAgentId: randomUUID(), createdAt: Date.now() };
    this.store.bots.push(bot);
    await this.store.saveBots();
    try {
      // Its session opens while it is created, and asks for its bot. The model is explicit: otherwise
      // Paseo picks one (an `omp-nilo` hub got Fable 5 at low).
      await client.createAgent({
        agentId: bot.hubAgentId,
        workspaceId: bot.workspaceId,
        config: { provider: PROVIDER_ID, cwd: bot.cwd, title: bot.name, providerOptions: { botId: bot.id }, model: DEFAULT_MODEL, thinkingOptionId: DEFAULT_THINKING },
        labels: { [ROLE_LABEL]: "hub", [HUB_LABEL]: bot.id, [EMOJI_LABEL]: bot.emoji, [COUNTS_LABEL]: "0,0" },
      });
    } catch (error) {
      this.store.bots = this.store.bots.filter(other => other !== bot);
      await this.store.saveBots();
      await client.archiveWorkspace(bot.workspaceId).catch(() => undefined);
      throw error;
    }
    return bot;
  }

  async updateBot(id: string, raw: BotInput): Promise<void> {
    const bot = this.#bot(id);
    const input = await this.#complete(raw);
    Object.assign(bot, input);
    await this.store.saveBots();
    const client = await daemon();
    await client.updateAgent(bot.hubAgentId, { name: input.name, labels: { [EMOJI_LABEL]: input.emoji } });
    await client.setWorkspaceTitle(bot.workspaceId, `${input.emoji} ${input.name}`);
  }

  async threadCount(id: string): Promise<number> {
    let count = 0;
    for (const day of await this.store.days(id)) count += (await this.store.day(id, day)).length;
    return count;
  }

  /**
   * Deletes the bot's threads (running ones stopped first) with their session files, rows and saved
   * copies, its hub and its workspace. Its Works-in folder stays.
   */
  async deleteBot(id: string): Promise<void> {
    const bot = this.#bot(id);
    // From here the hooks, the queue and the sweep no longer see it.
    this.store.bots = this.store.bots.filter(other => other !== bot);
    await this.store.saveBots();
    for (const [sessionId, hub] of this.#hubs) if (hub.botId === id) this.#hubs.delete(sessionId);
    clearTimeout(this.#countTimers.get(id));
    this.#countTimers.delete(id);
    const threads: string[] = [];
    for (const day of await this.store.days(id)) threads.push(...(await this.store.day(id, day)).map(thread => thread.id));
    for (const thread of threads) this.#active.delete(thread);
    const client = await daemon();
    for (const agentId of [...threads, bot.hubAgentId]) {
      try {
        const agent = (await client.fetchAgent(agentId).catch(() => null))?.agent;
        if (!agent) continue;
        if (agent.status === "running") await client.cancelAgent(agentId);
        // Paseo tells only this connection about a delete; an archive reaches every client, so open
        // tabs close and the sidebar strip drops the hub at once.
        if (!agent.archivedAt) await client.archiveAgent(agentId);
        await client.deleteAgent(agentId);
        const file = agent.persistence?.nativeHandle;
        if (file?.startsWith(sessionsDir() + "/")) {
          await rm(file, { force: true });
          await rm(file.replace(/\.jsonl$/, ""), { recursive: true, force: true });
        }
      } catch (error) {
        console.error(`noice-bots: deleting ${agentId} of ${bot.name} failed`, error);
      }
    }
    await this.store.removeThreads(id, threads);
    const projectId = await projectOf(bot.workspaceId).catch(() => undefined);
    const archived = await client.archiveWorkspace(bot.workspaceId).catch(error => ({ error: String(error) }));
    if (archived.error) throw new Error(`${bot.name} is deleted, but its workspace couldn't be closed: ${archived.error}`);
    // Making the bot's workspace made its folder a Paseo project. With no workspace left in it, the
    // sidebar would list it as an empty project; one with other workspaces stays.
    if (!projectId) return;
    const rest = await client.fetchWorkspaces({ includeBackground: true, filter: { projectId, includeBackground: true }, page: { limit: 1 } });
    if (rest.entries.length === 0) await client.removeProject(projectId).catch(error => console.error(`noice-bots: removing ${bot.name}'s empty project failed`, error));
  }

  /** `completeBot`, and the provider must be one `providers` lists. */
  async #complete(raw: BotInput): Promise<BotInput> {
    const providers = await this.providers();
    if (!providers.some(provider => provider.id === raw.provider)) {
      throw new Error(`Threads can't run on "${raw.provider}". Pick one of: ${providers.map(provider => provider.id).join(", ")}.`);
    }
    return completeBot(raw, (await this.limits()).botsFolder);
  }

  /** OMP and the enabled providers that extend it (from the daemon's config file, as the API doesn't say). */
  async providers(): Promise<{ id: string; label: string }[]> {
    const config = JSON.parse(await readFile(join(paseoHome(), "config.json"), "utf8").catch(() => "{}"));
    const configured: Record<string, { extends?: string }> = config?.agents?.providers ?? {};
    const { entries } = await (await daemon()).getProvidersSnapshot();
    return entries
      .filter(entry => entry.enabled && (entry.provider === "omp" || configured[entry.provider]?.extends === "omp"))
      .map(entry => ({ id: entry.provider, label: entry.label ?? entry.provider }));
  }

  providerOf(botId: string): string { return this.store.bot(botId)?.provider ?? "omp"; }

  #bot(id: string): Bot {
    const bot = this.store.bot(id);
    if (!bot) throw new Error(`Unknown bot ${id}`);
    return bot;
  }

  // ---------------------------------------------------------------- hub sessions

  /**
   * Paseo keeps the rows a hub already has and skips what a reopened plugin session replays, so the
   * hub draws once Paseo listens, and only the threads that changed while it was closed (`redraw`).
   * Your messages are Paseo's own rows.
   */
  async openHub(sessionId: string, botId: string, config: ProviderSessionConfig, emit: (event: ProviderEvent) => void): Promise<void> {
    await this.#storeLoaded;
    this.#bot(botId);
    const hub: HubSession = { botId, agentId: config.env.PASEO_AGENT_ID ?? "", emit, config, ready: false };
    this.#hubs.set(sessionId, hub);
    setTimeout(() => void this.#drawHub(sessionId, hub).catch(error => console.error("noice-bots: drawing a hub failed", error)), 1000);
  }

  async #drawHub(sessionId: string, hub: HubSession): Promise<void> {
    const bot = this.store.bot(hub.botId);
    if (this.#hubs.get(sessionId) !== hub || bot?.hubAgentId !== hub.agentId) return;
    hub.ready = true;
    const ids = bot.redraw ?? [];
    if (!ids.length) return;
    bot.redraw = undefined;
    for (const id of ids) {
      const thread = this.#active.get(id) ?? await this.store.thread(id);
      if (thread) hub.emit(this.#threadItem(sessionId, thread));
    }
    await this.store.saveBots();
  }

  closeHub(sessionId: string): void { this.#hubs.delete(sessionId); }
  hub(sessionId: string): HubSession | undefined { return this.#hubs.get(sessionId); }

  #threadItem(sessionId: string, thread: Thread): ProviderEvent {
    return { type: "timeline.item", sessionId, timestamp: new Date(thread.createdAt).toISOString(), item: { type: "plugin", id: `thread-${thread.id}`, pluginId: PLUGIN_ID, kind: THREAD_KIND, version: 1, data: thread } };
  }

  /** Redraws a thread's block in place in its bot's hub, and the bot's sidebar counts. */
  #changed(thread: Thread): void {
    const bot = this.store.bot(thread.botId);
    let shown = false;
    for (const [sessionId, hub] of this.#hubs) {
      if (hub.agentId !== bot?.hubAgentId || !hub.ready) continue;
      hub.emit(this.#threadItem(sessionId, thread));
      shown = true;
    }
    // Hub closed (plugin reload, idle cleanup) or not drawn yet: it draws the thread when it opens.
    if (bot && !shown) {
      if (!bot.redraw?.includes(thread.id)) {
        bot.redraw = [...bot.redraw ?? [], thread.id];
        void this.store.saveBots();
      }
      if (![...this.#hubs.values()].some(hub => hub.agentId === bot.hubAgentId)) this.#reopenHub(bot.id);
    }
    void this.store.saveDay(thread);
    this.#updateCounts(thread.botId);
  }

  #reopenHub(botId: string): void {
    const bot = this.store.bot(botId);
    if (!bot || this.#reopening.has(botId)) return;
    this.#reopening.add(botId);
    void daemon()
      .then(client => client.refreshAgent(bot.hubAgentId))
      .catch(error => console.error(`noice-bots: reopening ${bot.name}'s hub failed`, error))
      .finally(() => this.#reopening.delete(botId));
  }

  /** A hub message: becomes a new thread with the hub's model, thinking and mode. The hub's own turn is over at once. */
  async ask(sessionId: string, clientMessageId: string, text: string, attached: Attached): Promise<void> {
    const hub = this.#hubs.get(sessionId);
    if (!hub) throw new Error(`Unknown hub session ${sessionId}`);
    const bot = this.#bot(hub.botId);
    const id = randomUUID();
    // Images go to disk first: a queued thread starts later, and the thread may keep them.
    const files = [...attached.files];
    if (attached.images.length) await mkdir(mediaDir(id), { recursive: true });
    for (const [index, image] of attached.images.entries()) {
      const file = join(mediaDir(id), `${index + 1}.${extensionOf(image.mimeType)}`);
      await writeFile(file, Buffer.from(image.data, "base64"));
      files.push(file);
    }
    const shown = files.length ? `${text}${text ? "\n" : ""}📎 ${files.length} attached` : text;
    hub.emit({ type: "timeline.item", sessionId, item: { type: "user_message", id: `question-${id}`, text: shown, clientMessageId } });
    hub.emit({ type: "session.prompt_result", sessionId, clientMessageId, result: { type: "completed" } });
    const thread: Thread = {
      id, botId: bot.id, workspaceId: bot.workspaceId, title: titleOf(text) || "📎 Attachment", question: text, answer: "", status: "queued",
      createdAt: Date.now(), startedAt: null, endedAt: null, followUps: 0, note: "", unread: false, readOnly: false,
      model: hub.config.model, thinking: hub.config.thinkingOption, mode: hub.config.mode, questionId: clientMessageId,
      ...(files.length ? { files } : {}),
    };
    this.#active.set(id, thread);
    await this.store.add(thread);
    this.#changed(thread);
    await this.#schedule(bot.id);
  }

  async #schedule(botId: string): Promise<void> {
    const { maxRunning } = await this.limits();
    const mine = [...this.#active.values()].filter(thread => thread.botId === botId);
    let running = mine.filter(thread => thread.status === "running").length;
    for (const thread of mine.filter(thread => thread.status === "queued").sort((a, b) => a.createdAt - b.createdAt)) {
      if (running >= maxRunning) return;
      running++;
      await this.#start(thread).catch(error => this.#finish(thread, "failed", [
        { role: "user", text: thread.question },
        { role: "assistant", text: `Could not start: ${error instanceof Error ? error.message : String(error)}` },
      ]));
    }
  }

  async #start(thread: Thread): Promise<void> {
    const bot = this.#bot(thread.botId);
    thread.status = "running";
    thread.startedAt = Date.now();
    this.#changed(thread);
    const files = thread.files ?? [];
    const images = await Promise.all(files.flatMap(file => {
      const mimeType = IMAGE_TYPES[extname(file).slice(1).toLowerCase()];
      return mimeType ? [readFile(file).then(bytes => ({ data: bytes.toString("base64"), mimeType }))] : [];
    }));
    const listed = files.length ? `${thread.question}\n\nAttached (saved on disk):\n${files.map(file => `- ${file}`).join("\n")}`.trim() : thread.question;
    await (await daemon()).createAgent({
      agentId: thread.id,
      workspaceId: bot.workspaceId,
      config: {
        provider: bot.provider, cwd: bot.cwd, title: thread.title, systemPrompt: bot.prompt + PROGRESS_HINT,
        ...(thread.model ? { model: thread.model } : {}), ...(thread.thinking ? { thinkingOptionId: thread.thinking } : {}), ...(thread.mode ? { modeId: thread.mode } : {}),
      },
      initialPrompt: listed,
      ...(images.length ? { images } : {}),
      labels: { [THREAD_LABEL]: bot.id },
    });
  }

  // ---------------------------------------------------------------- thread lifecycle (hooks)

  #known(workspaceId: string | null): boolean { return this.store.botOfWorkspace(workspaceId) !== undefined; }

  async turnStarted(agentId: string, workspaceId: string | null): Promise<void> {
    if (!this.#known(workspaceId)) return;
    const thread = this.#active.get(agentId) ?? await this.store.thread(agentId);
    if (!thread || thread.status === "running") return;
    // A follow-up in a woken thread; a settled thread is back in play.
    thread.status = "running";
    thread.endedAt = null;
    thread.settled = undefined;
    this.#active.set(thread.id, thread);
    this.#changed(thread);
  }

  async turnEnded(agentId: string, workspaceId: string | null, outcome: "done" | "failed" | "stopped"): Promise<void> {
    if (!this.#known(workspaceId)) return;
    const thread = this.#active.get(agentId) ?? await this.store.thread(agentId);
    if (!thread) return;
    const page = await (await daemon()).fetchAgentTimeline(agentId, { direction: "tail", limit: 2000, projection: "projected" }).catch(() => null);
    const messages = page ? transcript(page.entries.map(entry => entry.item as AgentTimelineItem)) : await this.store.messages(agentId);
    await this.#finish(thread, outcome, messages);
    // Archiving closes an open chat tab, so a thread whose chat was opened stays up; closing its tab archives it.
    if (!thread.awake) await this.#sleep(agentId);
  }

  async #finish(thread: Thread, outcome: "done" | "failed" | "stopped", messages: Message[]): Promise<void> {
    const first = thread.answer === "";
    thread.status = outcome;
    thread.endedAt = Date.now();
    thread.note = "";
    // The hub shows a few lines; the saved copy keeps all of it.
    thread.answer = (messages.find(message => message.role === "assistant")?.text ?? thread.answer).slice(0, ANSWER_LIMIT);
    thread.followUps = Math.max(0, messages.filter(message => message.role === "user").length - 1);
    if (first) thread.unread = true;
    this.#active.delete(thread.id);
    await this.store.setMessages(thread, messages);
    this.#changed(thread);
    void this.#schedule(thread.botId);
  }

  /** Sleep: archiving shuts the thread's provider process down. */
  async #sleep(agentId: string): Promise<void> {
    await (await daemon()).archiveAgent(agentId).catch(error => console.error(`noice-bots: archiving thread ${agentId} failed`, error));
  }

  /** The user opened the thread's chat: it stays up after its turn until its tab is closed. */
  async opened(id: string): Promise<void> { await this.#setAwake(id, true); }
  async archived(id: string): Promise<void> { await this.#setAwake(id, false); }

  async #setAwake(id: string, awake: boolean): Promise<void> {
    const thread = this.#active.get(id) ?? await this.store.thread(id);
    if (!thread || !!thread.awake === awake) return;
    thread.awake = awake;
    await this.store.saveDay(thread);
  }

  async wake(id: string): Promise<void> {
    const thread = await this.store.thread(id);
    if (!thread) throw new Error("Unknown thread");
    if (thread.readOnly) throw new Error("This thread is read-only now; its agent was removed.");
    await this.#setAwake(id, true);
    if (thread.settled) this.#setSettled(thread, false);
    await (await daemon()).refreshAgent(id);
  }

  progress(agentId: string, update: { note?: string; title?: string }): boolean {
    const thread = this.#active.get(agentId);
    if (!thread || thread.status !== "running") return false;
    if (update.note) thread.note = oneLine(update.note).slice(0, 200);
    const title = update.title ? oneLine(update.title).slice(0, 60) : "";
    if (title && title !== thread.title) {
      thread.title = title;
      thread.named = true;
      // Paseo keeps the agent's title in its record: the tab shows it, and it survives sleep and wake.
      void daemon().then(client => client.updateAgent(agentId, { name: title }))
        .catch(error => console.error(`noice-bots: renaming thread ${agentId} failed`, error));
    }
    this.#changed(thread);
    return true;
  }

  async read(id: string): Promise<{ thread: Thread; messages: Message[] } | undefined> {
    const thread = this.#active.get(id) ?? await this.store.thread(id);
    if (!thread) return undefined;
    return { thread, messages: await this.store.messages(id) };
  }

  async markRead(thread: Thread): Promise<void> {
    if (!thread.unread) return;
    thread.unread = false;
    this.#changed(thread);
  }

  async markAllRead(botId: string): Promise<void> {
    for (const day of await this.store.days(botId)) {
      for (const thread of await this.store.day(botId, day)) await this.markRead(thread);
    }
  }

  async settle(id: string, settled: boolean): Promise<void> {
    const thread = this.#active.get(id) ?? await this.store.thread(id);
    if (!thread) throw new Error("Unknown thread");
    if (settled && this.#active.has(id)) throw new Error("Only a finished thread can be settled.");
    if (settled) await this.#findQuestions([thread]);
    this.#setSettled(thread, settled);
  }

  async settleAllRead(botId: string): Promise<void> {
    const threads: Thread[] = [];
    for (const day of await this.store.days(botId)) {
      threads.push(...(await this.store.day(botId, day)).filter(thread => !thread.unread && !thread.settled && !this.#active.has(thread.id)));
    }
    await this.#findQuestions(threads);
    for (const thread of threads) this.#setSettled(thread, true);
  }

  /** Settled: read, one line in the hub, and the question above it hidden (`settledQuestions`). */
  #setSettled(thread: Thread, settled: boolean): void {
    if (!!thread.settled === settled) return;
    thread.settled = settled ? Date.now() : undefined;
    if (settled) thread.unread = false;
    this.#changed(thread);
  }

  /** The questions above settled threads, every bot's: the hub hides these rows. */
  async settledQuestions(): Promise<string[]> {
    const ids: string[] = [];
    for (const bot of this.store.bots) {
      for (const day of await this.store.days(bot.id)) {
        for (const thread of await this.store.day(bot.id, day)) if (thread.settled && thread.questionId) ids.push(thread.questionId);
      }
    }
    return ids;
  }

  /**
   * Threads asked before `questionId` was stored (all of one bot's): their question is the hub's
   * `user_message` right before their block.
   */
  async #findQuestions(threads: readonly Thread[]): Promise<void> {
    const missing = threads.filter(thread => !thread.questionId);
    if (!missing.length) return;
    const hubId = this.#bot(missing[0].botId).hubAgentId;
    const client = await daemon();
    const items: AgentTimelineItem[] = [];
    let page = await client.fetchAgentTimeline(hubId, { direction: "tail", limit: 1000, projection: "projected" });
    for (;;) {
      items.unshift(...page.entries.map(entry => entry.item as AgentTimelineItem));
      if (!page.hasOlder || !page.startCursor) break;
      page = await client.fetchAgentTimeline(hubId, { direction: "before", cursor: page.startCursor, limit: 1000, projection: "projected" });
    }
    const questionOf = new Map<string, string>();
    let question: string | undefined;
    for (const item of items) {
      if (item.type === "user_message") question = item.messageId ?? item.clientMessageId;
      else if (item.type === "plugin" && item.id?.startsWith("thread-") && question) {
        questionOf.set(item.id.slice("thread-".length), question);
        question = undefined;
      }
    }
    for (const thread of missing) thread.questionId = questionOf.get(thread.id);
  }

  /** Newest first; every word in your messages or the answers. Rows first, saved copies only where they hold more. */
  async search(botId: string, query: string): Promise<Thread[]> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (text: string) => words.every(word => text.includes(word));
    const found: Thread[] = [];
    for (const day of (await this.store.days(botId)).reverse()) {
      for (const thread of [...await this.store.day(botId, day)].reverse()) {
        const row = `${thread.question}\n${thread.answer}`.toLowerCase();
        const more = thread.followUps > 0 || thread.answer.length >= ANSWER_LIMIT;
        if (matches(row) || (more && matches((await this.store.messages(thread.id)).map(message => message.text).join("\n").toLowerCase()))) found.push(thread);
        if (found.length >= 50) return found;
      }
    }
    return found;
  }

  /** Read-only after N days: the agent and its session file go, the saved copy stays. */
  async sweep(): Promise<void> {
    const { readOnlyDays } = await this.limits();
    const cutoff = dayOf(Date.now() - readOnlyDays * 86_400_000);
    const client = await daemon();
    for (const bot of this.store.bots) {
      for (const day of (await this.store.days(bot.id)).filter(day => day < cutoff && day > (bot.sweptThrough ?? ""))) {
        for (const thread of await this.store.day(bot.id, day)) {
          if (thread.readOnly || this.#active.has(thread.id)) continue;
          try {
            const file = (await client.fetchAgent(thread.id))?.agent.persistence?.nativeHandle;
            await client.deleteAgent(thread.id);
            if (file?.startsWith(sessionsDir() + "/")) await rm(file, { force: true });
          } catch (error) {
            console.error(`noice-bots: making ${thread.id} read-only failed`, error);
            continue;
          }
          thread.readOnly = true;
          thread.awake = false;
          this.#changed(thread);
        }
        if ((await this.store.day(bot.id, day)).every(thread => thread.readOnly)) bot.sweptThrough = day;
      }
    }
    await this.store.saveBots();
  }

  // ---------------------------------------------------------------- sidebar counts

  /** `<running>,<unread>` on the hub agent; debounced, as a busy bot changes often. */
  #updateCounts(botId: string): void {
    if (this.#countTimers.has(botId)) return;
    this.#countTimers.set(botId, setTimeout(() => {
      this.#countTimers.delete(botId);
      void this.#writeCounts(botId).catch(error => console.error(`noice-bots: counts for ${botId} failed`, error));
    }, 500));
  }

  /** Unread threads newest first, over the last N days (the read-only period): what the sidebar counts. */
  async unread(botId: string): Promise<Thread[]> {
    const { readOnlyDays } = await this.limits();
    const found: Thread[] = [];
    for (const day of (await this.store.days(botId)).slice(-readOnlyDays).reverse()) {
      found.push(...(await this.store.day(botId, day)).filter(thread => thread.unread).reverse());
    }
    return found;
  }

  async #writeCounts(botId: string): Promise<void> {
    const bot = this.#bot(botId);
    const unread = (await this.unread(botId)).length;
    const running = [...this.#active.values()].filter(thread => thread.botId === botId && thread.status === "running").length;
    await (await daemon()).updateAgent(bot.hubAgentId, { labels: { [COUNTS_LABEL]: `${running},${unread}` } });
  }

  /** A raised cap starts queued threads; a shorter read-only period applies at once. */
  settingsChanged(): void {
    for (const bot of this.store.bots) void this.#schedule(bot.id);
    void this.sweep();
  }

  dispose(): void {
    for (const timer of this.#countTimers.values()) clearTimeout(timer);
    clearInterval(this.#sweeper);
  }
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function titleOf(text: string): string {
  const line = text.trim().split("\n")[0].replace(/\s+/g, " ");
  return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line;
}

/** Your messages and, per turn, the final reply: the assistant text after the turn's last tool call. */
export function transcript(items: readonly AgentTimelineItem[]): Message[] {
  const messages: Message[] = [];
  let reply = "";
  let inRun = false;
  const flush = () => {
    if (reply.trim()) messages.push({ role: "assistant", text: reply.trim() });
    reply = "";
    inRun = false;
  };
  for (const item of items) {
    if (item.type === "user_message") {
      flush();
      messages.push({ role: "user", text: item.text });
    } else if (item.type === "assistant_message") {
      reply = inRun ? reply + item.text : item.text;
      inRun = true;
    } else if (item.type !== "reasoning") {
      inRun = false;
    }
  }
  flush();
  return messages;
}

/** Fills an empty emoji, name or folder, and creates the folder if it is missing (`~` and relative paths start at home). */
async function completeBot(input: BotInput, botsFolder: string): Promise<BotInput> {
  const emoji = input.emoji || "🐻";
  const name = input.name || defaultName(emoji);
  const cwd = resolve(homedir(), (input.cwd || defaultFolder(botsFolder, name)).replace(/^~(?=\/|$)/, homedir()));
  await mkdir(cwd, { recursive: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST" || error.code === "ENOTDIR") throw new Error(`Can't use ${cwd} as the bot's folder: part of that path is a file.`);
    if (error.code === "EACCES" || error.code === "EPERM" || error.code === "EROFS") throw new Error(`No permission to create the folder ${cwd}.`);
    throw new Error(`Couldn't create the folder ${cwd} (${error.code ?? error.message}).`);
  });
  return { ...input, emoji, name, cwd };
}

async function projectOf(workspaceId: string): Promise<string | undefined> {
  const client = await daemon();
  let cursor: string | undefined;
  do {
    const page = await client.fetchWorkspaces({ includeBackground: true, page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    const found = page.entries.find(entry => entry.id === workspaceId);
    if (found) return found.projectId;
    cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
  } while (cursor);
  return undefined;
}
