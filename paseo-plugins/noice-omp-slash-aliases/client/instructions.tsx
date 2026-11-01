import type { PaseoAgent } from "@getpaseo/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { instructionsGet, instructionsSet } from "../shared/instructions";
import { BODY } from "./markdown-view";
import type { OmpProviders } from "./omp-providers";

const SMALL = { fontSize: 12, lineHeight: 16 };
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Paseo's plugin types leave out the DOM library; declare only what this module uses.
interface DomNode {
  parentElement: (DomNode & { style: { opacity: string } }) | null;
}

/**
 * What this client last read or saved per chat (`undefined` until read), and which chat's
 * editor `/instructions` opened.
 */
export class InstructionsStore {
  readonly #client: PluginClientContext;
  readonly #texts = new Map<string, string>();
  readonly #listeners = new Set<() => void>();
  editing: string | null = null;

  constructor(client: PluginClientContext) {
    this.#client = client;
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };
  #set(agentId: string, text: string) {
    this.#texts.set(agentId, text);
    this.#listeners.forEach(listener => listener());
  }
  text = (agentId: string) => this.#texts.get(agentId);

  async load(agentId: string): Promise<string> {
    const { text } = await this.#client.rpc(instructionsGet, { agentId });
    this.#set(agentId, text);
    return text;
  }
  async save(agentId: string, text: string): Promise<void> {
    await this.#client.rpc(instructionsSet, { agentId, text });
    this.#set(agentId, text.trim() ? text : "");
  }
  open(agentId: string | null) {
    this.editing = agentId;
    this.#listeners.forEach(listener => listener());
  }
}

function Button({ theme, label, primary, disabled, onPress }: { theme: PluginTheme; label: string; primary?: boolean; disabled?: boolean; onPress(): void }) {
  const { colors } = theme;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ hovered }: { pressed: boolean; hovered?: boolean }) => ({
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: primary ? colors.accent : colors.border,
        backgroundColor: primary ? colors.accent : hovered ? colors.surface2 : "transparent",
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text style={[BODY, { color: primary ? colors.accentForeground : colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

/** Reads the chat's instructions afresh on open; Save and Clear write them and close. */
function Editor({ store, agentId, theme, compact, close }: { store: InstructionsStore; agentId: string; theme: PluginTheme; compact: boolean; close(): void }) {
  const { colors } = theme;
  const [saved, setSaved] = useState<string>();
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    store.load(agentId).then(
      text => {
        setSaved(text);
        setDraft(current => current ?? text);
      },
      error => setError(errorText(error)),
    );
  }, [store, agentId]);
  const commit = (text: string) => {
    setBusy(true);
    setError(undefined);
    store.save(agentId, text).then(close, error => {
      setError(errorText(error));
      setBusy(false);
    });
  };
  const loading = saved === undefined;
  return (
    <View style={{ width: compact ? undefined : 396, gap: 8 }}>
      <TextInput
        multiline
        autoFocus
        editable={!loading && !busy}
        value={draft ?? ""}
        onChangeText={setDraft}
        placeholder={loading && !error ? "Loading…" : "A role or brief for this chat"}
        placeholderTextColor={colors.foregroundMuted}
        style={[BODY, { minHeight: 140, maxHeight: 320, padding: 8, borderWidth: 1, borderRadius: 6, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface0, textAlignVertical: "top" }]}
      />
      <Text style={[SMALL, { color: colors.foregroundMuted }]}>Added to this chat's system prompt from the next turn. Each edit makes the model re-read the chat once.</Text>
      {error ? <Text style={[SMALL, { color: colors.statusDanger }]}>{error}</Text> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button theme={theme} label="Clear" disabled={loading || busy || !saved} onPress={() => commit("")} />
        <Button theme={theme} label="Save" primary disabled={loading || busy || draft === saved} onPress={() => commit(draft ?? "")} />
      </View>
    </View>
  );
}

/**
 * One `Instructions` composer pill per OMP chat: dimmed while the chat has none (on web the whole
 * pill, elsewhere its icon, since Paseo draws every pill label muted), full colour once set. It
 * opens the editor in a popover. The icon also hosts the editor that `/instructions` opens, as a
 * modal (commands cannot open a pill's popover).
 */
export function startInstructionPills(client: PluginClientContext, providers: OmpProviders, store: InstructionsStore): () => void {
  function PillIcon(props: PluginButtonIconProps) {
    const agentId = props.context === "agent" ? props.agentId : "";
    const text = useSyncExternalStore(store.subscribe, () => store.text(agentId));
    const editing = useSyncExternalStore(store.subscribe, () => store.editing === agentId);
    useEffect(() => {
      if (store.text(agentId) === undefined) void store.load(agentId).catch(() => undefined);
    }, [agentId]);
    const { colors } = props.theme;
    const ref = useRef<View>(null);
    useEffect(() => {
      // The icon's parent is Paseo's icon slot; its parent is the pill.
      const pill = Platform.OS === "web" ? (ref.current as unknown as DomNode | null)?.parentElement?.parentElement : undefined;
      if (pill) pill.style.opacity = text ? "" : "0.55";
    }, [text]);
    return (
      <>
        <View ref={ref}>
          <Icon name="ScrollText" size={props.size} color={text ? colors.foreground : colors.foregroundMuted} />
        </View>
        <Modal title="Instructions for this chat" open={editing} onOpenChange={open => !open && store.open(null)}>
          <Modal.Content>
            {editing ? <Editor store={store} agentId={agentId} theme={props.theme} compact close={() => store.open(null)} /> : null}
          </Modal.Content>
        </Modal>
      </>
    );
  }
  function Popover(props: PluginButtonContentProps) {
    const agentId = props.context === "agent" ? props.agentId : "";
    return <Editor store={store} agentId={agentId} theme={props.theme} compact={props.layout.compact} close={props.close} />;
  }

  const pills = new Map<string, PluginButtonRegistration>();
  /** Each chat's newest snapshot, so a provider check that resolves late acts on current state. */
  const latest = new Map<string, PaseoAgent>();
  const remove = (agentId: string) => {
    latest.delete(agentId);
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };
  const observe = (agent: PaseoAgent) => {
    const workspaceId = agent.workspaceId;
    if (!workspaceId || agent.archivedAt || agent.internal) return remove(agent.id);
    latest.set(agent.id, agent);
    if (pills.has(agent.id)) return;
    void providers.isOmp(agent.provider).then(omp => {
      if (!omp || pills.has(agent.id) || latest.get(agent.id) !== agent || lifetime.signal.aborted) return;
      pills.set(agent.id, client.addComposerPill({
        id: "instructions",
        workspaceId,
        agentId: agent.id,
        button: { title: "Instructions for this chat", label: "Instructions", icon: PillIcon, behavior: { kind: "popover", Content: Popover } },
      }));
    }, () => undefined);
  };

  const lifetime = new AbortController();
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ entries, subscription }) => {
      if (lifetime.signal.aborted) return;
      const replace = (list: readonly { agent: PaseoAgent }[]) => {
        const ids = new Set(list.map(({ agent }) => agent.id));
        for (const agentId of [...pills.keys()]) if (!ids.has(agentId)) remove(agentId);
        for (const { agent } of list) observe(agent);
      };
      replace(entries);
      subscription.subscribe({
        snapshot: snapshot => replace(snapshot.entries),
        update: message => {
          if (message.type !== "agent_update") return;
          if (message.payload.kind === "remove") remove(message.payload.agentId);
          else observe(message.payload.agent);
        },
      });
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.warn("[noice-omp-slash-aliases] agent subscription failed", error);
    });

  return () => {
    lifetime.abort();
    for (const agentId of [...pills.keys()]) remove(agentId);
  };
}
