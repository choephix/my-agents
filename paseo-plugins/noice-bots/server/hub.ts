import {
  negotiateProviderCapabilities, type ProviderCatalog, type ProviderConfigState, type ProviderEvent, type ProviderInput, type ProviderRegistration,
} from "@getpaseo/plugin/server/provider";
import { DEFAULT_MODEL, DEFAULT_THINKING, type Bots } from "./bots";
import { daemon } from "./daemon";

const CAPABILITIES = ["prompt.message", "prompt.image", "session.configure", "session.persistence", "timeline.plugin"] as const;

/** The models, thinking levels and modes of the OMP provider a bot's threads run on. */
async function ompCatalog(provider: string): Promise<ProviderCatalog> {
  const client = await daemon();
  const [{ models = [] }, { modes = [] }] = await Promise.all([client.listProviderModels(provider), client.listProviderModes(provider)]);
  return {
    models: models.map(({ id, label, description, isDefault, thinkingOptions, defaultThinkingOptionId }) => ({
      id, label, description, isDefault, defaultThinkingOptionId,
      thinkingOptions: thinkingOptions?.map(({ id, label, description, isDefault }) => ({ id, label, description, isDefault })),
    })),
    modes: modes.map(({ id, label, description, icon, colorTier }) => ({ id, label, description, icon, colorTier })),
    defaultModel: models.find(model => model.isDefault)?.id,
  };
}

/**
 * The hub: a chat that runs no model. Each message starts a thread (a real OMP agent) and the
 * hub's turn ends at once; the threads show as plugin rows drawn from the plugin's files.
 */
export function hubProvider(bots: Bots): ProviderRegistration {
  return {
    id: "bots",
    label: "Bot hub",
    description: "Each message starts its own thread with the bot's system prompt",
    icon: "icon.svg",
    async connect(request) {
      const capabilities = negotiateProviderCapabilities(request.capabilities, CAPABILITIES);
      const listeners = new Set<(event: ProviderEvent) => void>();
      const sessions = new Set<string>();
      const emit = (event: ProviderEvent) => { for (const listener of listeners) listener(event); };
      const catalogs = new Map<string, Promise<ProviderCatalog>>();
      const loadCatalog = (provider: string) => {
        const catalog = catalogs.get(provider) ?? ompCatalog(provider);
        catalogs.set(provider, catalog);
        catalog.catch(() => catalogs.delete(provider));
        return catalog;
      };
      /** Commits what new threads will use: the picked model, else Opus 5.5 at high (else OMP's default and its default thinking level). */
      const configState = async (sessionId: string): Promise<ProviderConfigState> => {
        const hub = bots.hub(sessionId)!;
        const { models, modes } = await loadCatalog(bots.providerOf(hub.botId));
        const picked = models.find(entry => entry.id === hub.config.model);
        const model = picked ?? models.find(entry => entry.id === DEFAULT_MODEL) ?? models.find(entry => entry.isDefault) ?? models[0];
        const preferred = picked ? hub.config.thinkingOption : DEFAULT_THINKING;
        const thinking = model?.thinkingOptions?.some(option => option.id === preferred) ? preferred : model?.defaultThinkingOptionId;
        hub.config = { ...hub.config, model: model?.id, thinkingOption: thinking };
        return { model: model?.id, mode: hub.config.mode, thinkingOption: thinking, models, modes, thinkingOptions: [], settings: [] };
      };
      const fail = (requestId: string, error: unknown) => emit({ type: "request.failed", requestId, error: { message: error instanceof Error ? error.message : String(error) } });

      async function handle(input: ProviderInput): Promise<void> {
        switch (input.type) {
          case "catalog":
            emit({ type: "catalog", requestId: input.requestId, catalog: await loadCatalog(bots.store.bots.find(bot => bot.cwd === input.cwd)?.provider ?? "omp") });
            return;
          case "session.open": {
            const persisted = input.persistence?.data as { botId?: unknown } | undefined;
            const botId = String(input.config.providerOptions?.botId ?? persisted?.botId ?? "");
            sessions.add(input.sessionId);
            const persistence = { version: 1, data: { botId } };
            emit({ type: "session.opened", requestId: input.requestId, sessionId: input.sessionId, capabilities, restoration: "core", persistence, cwd: input.config.cwd });
            await bots.openHub(input.sessionId, botId, input.config, emit);
            emit({ type: "session.config", sessionId: input.sessionId, config: await configState(input.sessionId) });
            emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
            return;
          }
          case "session.configure": {
            const hub = bots.hub(input.sessionId)!;
            const { model, mode, thinkingOption } = input.changes;
            hub.config = {
              ...hub.config,
              ...(model !== undefined ? { model: model ?? undefined } : {}),
              ...(mode !== undefined ? { mode: mode ?? undefined } : {}),
              ...(thinkingOption !== undefined ? { thinkingOption: thinkingOption ?? undefined } : {}),
            };
            emit({ type: "session.config", sessionId: input.sessionId, config: await configState(input.sessionId) });
            emit({ type: "request.completed", requestId: input.requestId });
            return;
          }
          case "session.prompt": {
            const { prompt } = input;
            if (prompt.input.type !== "message") {
              emit({ type: "session.prompt_result", sessionId: input.sessionId, clientMessageId: prompt.clientMessageId, result: { type: "failed", error: { message: "The hub takes plain messages." } } });
              return;
            }
            const { content } = prompt.input;
            const text = content.flatMap(part => (part.type === "text" ? [part.text] : [])).join("\n").trim();
            const images = content.flatMap(part => (part.type === "image" ? [{ data: part.data, mimeType: part.mimeType }] : []));
            const files = content.flatMap(part => (part.type === "uploaded_file" ? [part.path] : []));
            await bots.ask(input.sessionId, prompt.clientMessageId, text, { images, files });
            return;
          }
          case "session.interrupt":
            emit({ type: "request.completed", requestId: input.requestId });
            return;
          case "session.close":
            sessions.delete(input.sessionId);
            bots.closeHub(input.sessionId);
            emit({ type: "session.closed", sessionId: input.sessionId });
            emit({ type: "request.completed", requestId: input.requestId });
            return;
          default:
            if ("requestId" in input) fail(input.requestId, new Error(`Unsupported: ${input.type}`));
        }
      }

      return {
        version: 1,
        capabilities,
        async send(input) {
          queueMicrotask(() => {
            handle(input).catch(error => {
              console.error(`noice-bots: hub ${input.type} failed`, error);
              if ("requestId" in input) fail(input.requestId, error);
              else if (input.type === "session.prompt") {
                emit({ type: "session.prompt_result", sessionId: input.sessionId, clientMessageId: input.prompt.clientMessageId, result: { type: "failed", error: { message: error instanceof Error ? error.message : String(error) } } });
              }
            });
          });
        },
        onEvent(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async close() {
          for (const sessionId of sessions) bots.closeHub(sessionId);
          sessions.clear();
          listeners.clear();
        },
      };
    },
  };
}
