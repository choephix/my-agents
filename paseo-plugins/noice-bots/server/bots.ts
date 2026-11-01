import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { ProviderEvent, ProviderSessionConfig } from "@getpaseo/plugin/server/provider";
import {
  COUNTS_LABEL, DAY_KIND, defaultFolder, defaultName, EMOJI_LABEL, HUB_LABEL, PLUGIN_ID, PROVIDER_ID, ROLE_LABEL, THREAD_KIND, THREAD_LABEL,
  type Bot, type BotInput, type Day, type Message, type Thread,
} from "../shared/contracts";
import { daemon } from "./daemon";
import { dayOf, sessionsDir, Store } from "./store";

export interface Limits { maxRunning: number; readOnlyDays: number; botsFolder: string }

interface HubSession { botId: string; emit(event: ProviderEvent): void; config: ProviderSessionConfig }

const PROGRESS_HINT = "\n\nWhile you work on something that takes more than a few steps, call thread_progress with a few words on what you are doing.";
/** Characters of the first answer kept on the hub's row. */
const ANSWER_LIMIT = 1500;

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
  #midnight: NodeJS.Timeout | undefined;
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
    const client = await daemon();
    for (const thread of [...this.#active.values()].filter(thread => thread.status === "running")) {
      const agent = (await client.fetchAgent(thread.id).catch(() => null))?.agent;
      if (agent?.status === "running" || agent?.status === "initializing") continue;
      await this.turnEnded(thread.id, thread.workspaceId, agent?.status === "error" ? "failed" : "done").catch(error => console.error(`noice-bots: settling ${thread.id} failed`, error));
    }
    await this.#rotateHubs();
    this.#atMidnight();
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
    const input = await completeBot(raw, (await this.limits()).botsFolder);
    // The same form sent again within a few minutes (a second tap, or a retry whose first answer
    // never showed) gets the bot already made.
    const same = this.store.bots.find(bot => Date.now() - bot.createdAt < 300_000
      && bot.name === input.name && bot.emoji === input.emoji && bot.cwd === input.cwd && bot.prompt === input.prompt);
    if (same) return same;
    const client = await daemon();
    const id = randomUUID();
    const created = await client.createWorkspace({ source: { kind: "directory", path: input.cwd }, background: true, title: `${input.emoji} ${input.name}` });
    if (!created.workspace) throw new Error(created.error ?? "Creating the bot's workspace failed");
    const bot: Bot = { ...input, id, workspaceId: created.workspace.id, hubAgentId: randomUUID(), hubSince: Date.now(), createdAt: Date.now() };
    this.store.bots.push(bot);
    await this.store.saveBots();
    try {
      await this.#createHub(bot);
    } catch (error) {
      this.store.bots = this.store.bots.filter(other => other !== bot);
      await this.store.saveBots();
      await client.archiveWorkspace(bot.workspaceId).catch(() => undefined);
      throw error;
    }
    return bot;
  }

  /** Its session opens while it is created, and asks for its bot. */
  async #createHub(bot: Bot, picks: { model?: string; thinkingOptionId?: string; modeId?: string } = {}): Promise<void> {
    await (await daemon()).createAgent({
      agentId: bot.hubAgentId,
      workspaceId: bot.workspaceId,
      config: { provider: PROVIDER_ID, cwd: bot.cwd, title: bot.name, providerOptions: { botId: bot.id }, ...picks },
      labels: { [ROLE_LABEL]: "hub", [HUB_LABEL]: bot.id, [EMOJI_LABEL]: bot.emoji, [COUNTS_LABEL]: "0,0" },
    });
  }

  /**
   * Paseo keeps its own copy of a hub's timeline, so a hub can't drop yesterday's rows. Instead each
   * day every bot gets a new hub agent with the old one's model, thinking and mode; older days show
   * as dividers in it, and the old hub is deleted.
   */
  async #rotateHubs(): Promise<void> {
    const today = dayOf(Date.now());
    const client = await daemon();
    for (const bot of this.store.bots) {
      if (dayOf(bot.hubSince ?? bot.createdAt) === today) continue;
      const old = { hubAgentId: bot.hubAgentId, hubSince: bot.hubSince };
      try {
        const agent = (await client.fetchAgent(old.hubAgentId).catch(() => null))?.agent;
        Object.assign(bot, { hubAgentId: randomUUID(), hubSince: Date.now() });
        await this.#createHub(bot, { model: agent?.model ?? undefined, thinkingOptionId: agent?.thinkingOptionId ?? undefined, modeId: agent?.currentModeId ?? undefined });
        await this.store.saveBots();
        await client.deleteAgent(old.hubAgentId).catch(error => console.error(`noice-bots: deleting ${bot.name}'s old hub failed`, error));
      } catch (error) {
        Object.assign(bot, old);
        console.error(`noice-bots: a new hub for ${bot.name} failed`, error);
      }
    }
  }

  #atMidnight(): void {
    const next = new Date();
    next.setHours(24, 0, 1, 0);
    this.#midnight = setTimeout(() => {
      void this.#rotateHubs();
      this.#atMidnight();
    }, next.getTime() - Date.now());
  }

  async updateBot(id: string, raw: BotInput): Promise<void> {
    const bot = this.#bot(id);
    const input = await completeBot(raw, (await this.limits()).botsFolder);
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

  #bot(id: string): Bot {
    const bot = this.store.bot(id);
    if (!bot) throw new Error(`Unknown bot ${id}`);
    return bot;
  }

  // ---------------------------------------------------------------- hub sessions

  /**
   * Paseo keeps the rows a hub already has and skips replayed ones, so the hub draws live once Paseo
   * listens: older days as dividers, and today's blocks again, as a thread may have changed while the
   * hub was closed. Your messages are Paseo's own rows.
   */
  async openHub(sessionId: string, botId: string, config: ProviderSessionConfig, emit: (event: ProviderEvent) => void): Promise<void> {
    await this.#storeLoaded;
    this.#bot(botId);
    this.#hubs.set(sessionId, { botId, emit, config });
    setTimeout(() => void this.#drawHub(sessionId, botId, emit).catch(error => console.error("noice-bots: drawing a hub failed", error)), 1000);
  }

  async #drawHub(sessionId: string, botId: string, emit: (event: ProviderEvent) => void): Promise<void> {
    if (this.#hubs.get(sessionId)?.emit !== emit) return;
    const today = dayOf(Date.now());
    for (const day of (await this.store.days(botId)).filter(day => day < today).slice(-30)) {
      const count = (await this.store.day(botId, day)).length;
      if (count) emit(this.#dayItem(sessionId, botId, day, count));
    }
    for (const thread of await this.store.day(botId, today)) emit(this.#threadItem(sessionId, thread));
  }

  closeHub(sessionId: string): void { this.#hubs.delete(sessionId); }
  hub(sessionId: string): HubSession | undefined { return this.#hubs.get(sessionId); }

  #dayItem(sessionId: string, botId: string, day: string, count: number): ProviderEvent {
    const yesterday = dayOf(Date.now() - 86_400_000);
    const label = day === yesterday ? "Yesterday" : new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const data: Day = { botId, workspaceId: this.#bot(botId).workspaceId, day, label, count };
    return { type: "timeline.item", sessionId, timestamp: new Date(`${day}T00:00:00`).toISOString(), item: { type: "plugin", id: `day-${day}`, pluginId: PLUGIN_ID, kind: DAY_KIND, version: 1, data } };
  }

  #threadItem(sessionId: string, thread: Thread): ProviderEvent {
    return { type: "timeline.item", sessionId, timestamp: new Date(thread.createdAt).toISOString(), item: { type: "plugin", id: `thread-${thread.id}`, pluginId: PLUGIN_ID, kind: THREAD_KIND, version: 1, data: thread } };
  }

  /** Redraws a thread's block in every open hub of its bot, and the bot's sidebar counts. */
  #changed(thread: Thread): void {
    let shown = false;
    for (const [sessionId, hub] of this.#hubs) {
      if (hub.botId !== thread.botId) continue;
      hub.emit(this.#threadItem(sessionId, thread));
      shown = true;
    }
    // No open hub session (plugin reload, idle cleanup): reopen it; opening redraws today's rows.
    if (!shown) this.#reopenHub(thread.botId);
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
  async ask(sessionId: string, clientMessageId: string, text: string): Promise<void> {
    const hub = this.#hubs.get(sessionId);
    if (!hub) throw new Error(`Unknown hub session ${sessionId}`);
    const bot = this.#bot(hub.botId);
    const id = randomUUID();
    hub.emit({ type: "timeline.item", sessionId, item: { type: "user_message", id: `question-${id}`, text, clientMessageId } });
    hub.emit({ type: "session.prompt_result", sessionId, clientMessageId, result: { type: "completed" } });
    const thread: Thread = {
      id, botId: bot.id, workspaceId: bot.workspaceId, title: titleOf(text), question: text, answer: "", status: "queued",
      createdAt: Date.now(), startedAt: null, endedAt: null, followUps: 0, note: "", unread: false, readOnly: false,
      model: hub.config.model, thinking: hub.config.thinkingOption, mode: hub.config.mode,
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
    await (await daemon()).createAgent({
      agentId: thread.id,
      workspaceId: bot.workspaceId,
      config: {
        provider: "omp", cwd: bot.cwd, title: thread.title, systemPrompt: bot.prompt + PROGRESS_HINT,
        ...(thread.model ? { model: thread.model } : {}), ...(thread.thinking ? { thinkingOptionId: thread.thinking } : {}), ...(thread.mode ? { modeId: thread.mode } : {}),
      },
      initialPrompt: thread.question,
      labels: { [THREAD_LABEL]: bot.id },
    });
  }

  // ---------------------------------------------------------------- thread lifecycle (hooks)

  #known(workspaceId: string | null): boolean { return this.store.botOfWorkspace(workspaceId) !== undefined; }

  async turnStarted(agentId: string, workspaceId: string | null): Promise<void> {
    if (!this.#known(workspaceId)) return;
    const thread = this.#active.get(agentId) ?? await this.store.thread(agentId);
    if (!thread || thread.status === "running") return;
    // A follow-up in a woken thread.
    thread.status = "running";
    thread.endedAt = null;
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
    await (await daemon()).refreshAgent(id);
  }

  progress(agentId: string, note: string): boolean {
    const thread = this.#active.get(agentId);
    if (!thread || thread.status !== "running") return false;
    thread.note = note.replace(/\s+/g, " ").trim().slice(0, 200);
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

  async #writeCounts(botId: string): Promise<void> {
    const bot = this.#bot(botId);
    const { readOnlyDays } = await this.limits();
    let unread = 0;
    for (const day of (await this.store.days(botId)).slice(-readOnlyDays)) {
      unread += (await this.store.day(botId, day)).filter(thread => thread.unread).length;
    }
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
    clearTimeout(this.#midnight);
  }
}

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
