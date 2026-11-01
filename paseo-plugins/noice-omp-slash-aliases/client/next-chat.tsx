import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";
import { nextChatArmed, nextChatGet, nextChatSet } from "../shared/next-chat";
import { type DraftButtons, watchDraftComposers } from "./draft-button";
import { BODY } from "./markdown-view";
import { tabTitle } from "./phone-menu";

const TITLE = "Instructions for the next chat";
const SMALL = { fontSize: 12, lineHeight: 16 };
const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
/** Web event props (React DOM names) that stop at the wrapper; React Native's types omit them. */
const ISOLATE = Object.fromEntries(
  ["onClick", "onPointerDown", "onPointerUp", "onPointerOver", "onPointerOut", "onMouseDown", "onMouseUp", "onMouseOver", "onMouseOut", "onKeyDown", "onKeyUp", "onTouchStart", "onTouchEnd"].map(name => [name, stop]),
);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

type Loaded = { armed: { text: string; expiresAt: number } | null; lastUsed: { title: string | null; text: string; at: number } | null };

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

/**
 * A header button per workspace (on phones a row of the workspace ⋯ menu): text armed there goes
 * into the system prompt of the next chat started in that workspace, once, within 30 minutes. The
 * daemon side keeps the text and puts it in (`agent.create` hook); this side shows which
 * workspaces are armed: read at start, when the app returns to the foreground, after a chat
 * appears in an armed workspace, and on each open of the editor. Expiry is timed locally.
 * On wide web layouts the button's icon also puts an `Instructions` button beside draft composers
 * (`draft-button.ts`) and hosts the editor it opens, as a modal.
 */
export function startNextChat(client: PluginClientContext): { chatCreated(workspaceId: string): void; stop(): void } {
  const expiries = new Map<string, number>();
  const buttons = new Map<string, { registration: PluginButtonRegistration; armed: boolean }>();
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  /** The workspace whose editor a draft composer's button opened. */
  let editing: string | null = null;
  const edit = (workspaceId: string | null) => {
    editing = workspaceId;
    listeners.forEach(listener => listener());
  };
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const apply = () => {
    const now = Date.now();
    for (const [workspaceId, expiresAt] of expiries) if (expiresAt <= now) expiries.delete(workspaceId);
    for (const [workspaceId, button] of buttons) {
      const armed = expiries.has(workspaceId);
      if (armed === button.armed) continue;
      button.armed = armed;
      button.registration.update(armed ? { title: `${TITLE} · armed`, label: "Instructions ✓" } : { title: TITLE, label: undefined });
    }
    listeners.forEach(listener => listener());
    clearTimeout(expiryTimer);
    const next = Math.min(...expiries.values());
    if (Number.isFinite(next)) expiryTimer = setTimeout(apply, next - now + 500);
  };
  const setArmed = (workspaceId: string, expiresAt: number | null) => {
    if (expiresAt === null) expiries.delete(workspaceId);
    else expiries.set(workspaceId, expiresAt);
    apply();
  };
  const refresh = () =>
    client.rpc(nextChatArmed, {}).then(
      ({ armed }) => {
        expiries.clear();
        for (const { workspaceId, expiresAt } of armed) expiries.set(workspaceId, expiresAt);
        apply();
      },
      (error: unknown) => console.warn("[noice-omp-slash-aliases] reading armed instructions failed", error),
    );

  function Editor({ workspaceId, theme, compact, close }: { workspaceId: string; theme: PluginTheme; compact: boolean; close(): void }) {
    const { colors } = theme;
    const [loaded, setLoaded] = useState<Loaded>();
    const [draft, setDraft] = useState<string>();
    const [error, setError] = useState<string>();
    const [busy, setBusy] = useState(false);
    useEffect(() => {
      client.rpc(nextChatGet, { workspaceId }).then(
        result => {
          setLoaded(result);
          setDraft(current => current ?? result.armed?.text ?? "");
          setArmed(workspaceId, result.armed?.expiresAt ?? null);
        },
        error => setError(errorText(error)),
      );
    }, [workspaceId]);
    const commit = (text: string) => {
      setBusy(true);
      setError(undefined);
      client.rpc(nextChatSet, { workspaceId, text }).then(
        ({ expiresAt }) => {
          setArmed(workspaceId, expiresAt);
          close();
        },
        error => {
          setError(errorText(error));
          setBusy(false);
        },
      );
    };
    const armed = loaded?.armed;
    const lastUsed = loaded?.lastUsed;
    return (
      <View style={{ width: compact ? undefined : 396, gap: 8 }}>
        <TextInput
          multiline
          autoFocus
          editable={loaded !== undefined && !busy}
          value={draft ?? ""}
          onChangeText={setDraft}
          placeholder={loaded || error ? "A role or brief for the next chat" : "Loading…"}
          placeholderTextColor={colors.foregroundMuted}
          style={[BODY, { minHeight: 140, maxHeight: 320, padding: 8, borderWidth: 1, borderRadius: 6, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface0, textAlignVertical: "top" }]}
        />
        <Text style={[SMALL, { color: colors.foregroundMuted }]}>
          {armed
            ? `Armed until ${clock(armed.expiresAt)}. The next chat you start in this workspace gets it in its system prompt, for good.`
            : "Arm it, then start a new chat in this workspace within 30 minutes: that chat gets it in its system prompt, for good. Chats started by agents don't take it; nor do Copilot, Cursor, Grok or Antigravity chats."}
        </Text>
        {lastUsed ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => setDraft(lastUsed.text)}>
            <Text style={[SMALL, { color: colors.foregroundMuted }]} numberOfLines={1}>
              Last used by “{tabTitle(lastUsed.title)}” at {clock(lastUsed.at)} · <Text style={{ color: colors.accent }}>Copy into the box</Text>
            </Text>
          </Pressable>
        ) : null}
        {error ? <Text style={[SMALL, { color: colors.statusDanger }]}>{error}</Text> : null}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button theme={theme} label="Clear" disabled={busy || !armed} onPress={() => commit("")} />
          <Button theme={theme} label="Arm" primary disabled={!loaded || busy || !draft?.trim() || draft === armed?.text} onPress={() => commit(draft ?? "")} />
        </View>
      </View>
    );
  }
  function Popover({ workspaceId, theme, layout, close }: PluginButtonContentProps) {
    return <Editor workspaceId={workspaceId} theme={theme} compact={layout.compact} close={close} />;
  }
  function HeaderIcon({ workspaceId, theme, layout, size, color }: PluginButtonIconProps) {
    const armed = useSyncExternalStore(subscribe, () => expiries.has(workspaceId));
    const open = useSyncExternalStore(subscribe, () => editing === workspaceId);
    const ref = useRef<View>(null);
    const drafts = useRef<DraftButtons>(undefined);
    useEffect(() => {
      const anchor = ref.current as unknown as HTMLElement | null;
      if (Platform.OS !== "web" || layout.compact || !anchor) return;
      drafts.current = watchDraftComposers(anchor, () => edit(workspaceId));
      return () => {
        drafts.current?.stop();
        drafts.current = undefined;
      };
    }, [workspaceId, layout.compact]);
    useEffect(() => drafts.current?.setArmed(armed, theme.colors.accent), [armed, theme.colors.accent, workspaceId, layout.compact]);
    return (
      <>
        <View ref={ref}>
          <Icon name="ScrollText" size={size} color={armed ? theme.colors.accent : color} />
        </View>
        {open ? (
          // React passes the modal's events up its tree, through the portal, to the header button
          // that hosts it: a click or a typed space would open the header popover too.
          <View {...ISOLATE}>
            <Modal title={TITLE} open onOpenChange={next => !next && edit(null)}>
              <Modal.Content>
                <Editor workspaceId={workspaceId} theme={theme} compact close={() => edit(null)} />
              </Modal.Content>
            </Modal>
          </View>
        ) : null}
      </>
    );
  }

  const add = (workspaceId: string) => {
    if (buttons.has(workspaceId)) return;
    try {
      const registration = client.addHeaderButton({ id: "next-chat", workspaceId, button: { title: TITLE, icon: HeaderIcon, behavior: { kind: "popover", Content: Popover } } });
      buttons.set(workspaceId, { registration, armed: false });
    } catch (error) {
      console.warn("[noice-omp-slash-aliases] header button failed", error);
    }
  };
  const remove = (workspaceId: string) => {
    buttons.get(workspaceId)?.registration.remove();
    buttons.delete(workspaceId);
  };
  const replace = (ids: ReadonlySet<string>) => {
    for (const id of [...buttons.keys()]) if (!ids.has(id)) remove(id);
    for (const id of ids) add(id);
    apply();
  };

  // One button per workspace, following Paseo's workspace directory (it pages at 200).
  const lifetime = new AbortController();
  const load = async () => {
    const first = await client.paseo.workspaces.list({ subscribe: {} });
    const ids = new Set(first.entries.map(workspace => workspace.id));
    let pageInfo = first.pageInfo;
    while (pageInfo.hasMore && pageInfo.nextCursor && !lifetime.signal.aborted) {
      const page = await client.paseo.workspaces.list({ page: { limit: 200, cursor: pageInfo.nextCursor } });
      for (const workspace of page.entries) ids.add(workspace.id);
      pageInfo = page.pageInfo;
    }
    if (lifetime.signal.aborted) return void first.subscription.release();
    replace(ids);
    first.subscription.subscribe({
      snapshot: snapshot => replace(new Set(snapshot.entries.map(workspace => workspace.id))),
      update: message => {
        if (message.type !== "workspace_update") return;
        if (message.payload.kind === "upsert") {
          add(message.payload.workspace.id);
          apply();
        } else remove(message.payload.id);
      },
    });
    lifetime.signal.addEventListener("abort", () => void first.subscription.release());
  };
  void load().catch((error: unknown) => {
    if (!lifetime.signal.aborted) console.warn("[noice-omp-slash-aliases] workspace subscription failed", error);
  });
  void refresh();
  const appState = AppState.addEventListener("change", state => state === "active" && void refresh());

  return {
    chatCreated(workspaceId) {
      if (expiries.has(workspaceId)) void refresh();
    },
    stop() {
      lifetime.abort();
      appState.remove();
      clearTimeout(expiryTimer);
      for (const id of [...buttons.keys()]) remove(id);
    },
  };
}
