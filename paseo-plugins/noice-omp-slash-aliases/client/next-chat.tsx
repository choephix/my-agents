import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";
import { nextChatArmed, nextChatGet, nextChatSet } from "../shared/next-chat";
import { startDraftButtons } from "./draft-button";
import { BODY } from "./markdown-view";
import { tabTitle } from "./phone-menu";

const TITLE = "Instructions for the next chat";
const SMALL = { fontSize: 12, lineHeight: 16 };
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
 * Text armed per workspace goes into the system prompt of the next chat started there, once,
 * within 30 minutes. The daemon side keeps the text and puts it in (`agent.create` hook); this side
 * shows which workspaces are armed: read at start, when the app returns to the foreground, after a
 * chat appears in an armed workspace, and on each open of an editor. Expiry is timed locally.
 *
 * Web: an `Instructions` pill beside each draft composer (`draft-button.ts`); the workspace header
 * button only with Settings → "Instructions header button" (off by default). Native apps have no
 * draft pill, so they always get the header button (on phones a row of the workspace ⋯ menu).
 */
export function startNextChat(client: PluginClientContext): { chatCreated(workspaceId: string): void; setHeaderButton(show: boolean): void; stop(): void } {
  const expiries = new Map<string, number>();
  const buttons = new Map<string, { registration: PluginButtonRegistration; armed: boolean }>();
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  // Web: hidden until the setting is read, so a switched-off button never flashes.
  let headerVisible = Platform.OS !== "web";
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
    drafts?.relabel();
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
  function HeaderIcon({ workspaceId, theme, size, color }: PluginButtonIconProps) {
    const armed = useSyncExternalStore(subscribe, () => expiries.has(workspaceId));
    return <Icon name="ScrollText" size={size} color={armed ? theme.colors.accent : color} />;
  }

  const drafts = Platform.OS === "web"
    ? startDraftButtons({
        armed: workspaceId => expiries.has(workspaceId),
        load: workspaceId => client.rpc(nextChatGet, { workspaceId }),
        save: async (workspaceId, text) => setArmed(workspaceId, (await client.rpc(nextChatSet, { workspaceId, text })).expiresAt),
      })
    : undefined;

  const add = (workspaceId: string) => {
    if (buttons.has(workspaceId)) return;
    try {
      const registration = client.addHeaderButton({ id: "next-chat", workspaceId, button: { title: TITLE, icon: HeaderIcon, visible: headerVisible, behavior: { kind: "popover", Content: Popover } } });
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
    setHeaderButton(show) {
      const visible = Platform.OS !== "web" || show;
      if (visible === headerVisible) return;
      headerVisible = visible;
      for (const { registration } of buttons.values()) registration.update({ visible });
    },
    stop() {
      lifetime.abort();
      appState.remove();
      clearTimeout(expiryTimer);
      for (const id of [...buttons.keys()]) remove(id);
      drafts?.stop();
    },
  };
}
